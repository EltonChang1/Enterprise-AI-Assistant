// Agent tools that the AI can execute via function calling

export const agentTools = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: 'Search the organization knowledge base for relevant information',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant documents'
          },
          topK: {
            type: 'number',
            description: 'Number of top results to return (default: 3)',
            default: 3
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Get the current date and time',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Timezone (e.g., UTC, America/New_York)',
            default: 'UTC'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Mathematical expression to evaluate (e.g., "2 + 2 * 3")'
          }
        },
        required: ['expression']
      }
    }
  }
];

function tokenizeMathExpression(expression) {
  const source = String(expression || '').trim();
  if (!source) {
    throw new Error('empty expression');
  }

  const tokens = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let end = index + 1;
      while (end < source.length && /[0-9.]/.test(source[end])) end += 1;
      const rawNumber = source.slice(index, end);
      if (!/^\d*\.?\d+$/.test(rawNumber)) {
        throw new Error('invalid number format');
      }
      tokens.push({ type: 'number', value: Number(rawNumber) });
      index = end;
      continue;
    }

    if ('+-*/()'.includes(char)) {
      if (char === '(' || char === ')') {
        tokens.push({ type: 'paren', value: char });
      } else {
        tokens.push({ type: 'operator', value: char });
      }
      index += 1;
      continue;
    }

    throw new Error('unsupported character in expression');
  }

  return tokens;
}

function toRpn(tokens) {
  const output = [];
  const operators = [];
  const precedence = { '+': 1, '-': 1, '*': 2, '/': 2, 'u-': 3 };
  const associativity = { '+': 'left', '-': 'left', '*': 'left', '/': 'left', 'u-': 'right' };

  let previous = null;

  for (const token of tokens) {
    if (token.type === 'number') {
      output.push(token);
      previous = token;
      continue;
    }

    if (token.type === 'operator') {
      let op = token.value;
      const isUnaryMinus =
        op === '-' &&
        (!previous || previous.type === 'operator' || (previous.type === 'paren' && previous.value === '('));

      if (isUnaryMinus) {
        op = 'u-';
      }

      while (operators.length > 0) {
        const top = operators[operators.length - 1];
        if (top.type !== 'operator') break;

        const topPrec = precedence[top.value];
        const curPrec = precedence[op];
        const isLeftAssoc = associativity[op] === 'left';

        if (topPrec > curPrec || (topPrec === curPrec && isLeftAssoc)) {
          output.push(operators.pop());
        } else {
          break;
        }
      }

      operators.push({ type: 'operator', value: op });
      previous = { type: 'operator', value: op };
      continue;
    }

    if (token.type === 'paren' && token.value === '(') {
      operators.push(token);
      previous = token;
      continue;
    }

    if (token.type === 'paren' && token.value === ')') {
      let foundOpening = false;
      while (operators.length > 0) {
        const top = operators.pop();
        if (top.type === 'paren' && top.value === '(') {
          foundOpening = true;
          break;
        }
        output.push(top);
      }

      if (!foundOpening) {
        throw new Error('mismatched parentheses');
      }

      previous = token;
    }
  }

  while (operators.length > 0) {
    const op = operators.pop();
    if (op.type === 'paren') {
      throw new Error('mismatched parentheses');
    }
    output.push(op);
  }

  return output;
}

function evaluateRpn(rpnTokens) {
  const stack = [];

  for (const token of rpnTokens) {
    if (token.type === 'number') {
      stack.push(token.value);
      continue;
    }

    if (token.type !== 'operator') {
      throw new Error('invalid token in expression');
    }

    if (token.value === 'u-') {
      if (stack.length < 1) throw new Error('invalid unary operation');
      stack.push(-stack.pop());
      continue;
    }

    if (stack.length < 2) throw new Error('invalid binary operation');
    const right = stack.pop();
    const left = stack.pop();

    switch (token.value) {
      case '+':
        stack.push(left + right);
        break;
      case '-':
        stack.push(left - right);
        break;
      case '*':
        stack.push(left * right);
        break;
      case '/':
        if (right === 0) throw new Error('division by zero');
        stack.push(left / right);
        break;
      default:
        throw new Error('unknown operator');
    }
  }

  if (stack.length !== 1 || !Number.isFinite(stack[0])) {
    throw new Error('invalid expression result');
  }

  return stack[0];
}

export function safeEvaluateMathExpression(expression) {
  const tokens = tokenizeMathExpression(expression);
  const rpn = toRpn(tokens);
  return evaluateRpn(rpn);
}

export async function executeToolCall(toolName, args, context) {
  const { db, retrieveContextForOrg, orgId } = context;

  switch (toolName) {
    case 'search_knowledge': {
      const { query, topK = 3 } = args;
      const results = await retrieveContextForOrg(orgId, query, topK);
      return {
        results: results.map((r) => ({
          source: r.source,
          text: r.text.slice(0, 400),
          score: Number(r.score.toFixed(3))
        }))
      };
    }

    case 'get_current_time': {
      const { timezone = 'UTC' } = args;
      try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          dateStyle: 'full',
          timeStyle: 'long'
        });
        return {
          datetime: formatter.format(now),
          timestamp: now.toISOString(),
          timezone
        };
      } catch (error) {
        return { error: `Invalid timezone: ${timezone}` };
      }
    }

    case 'calculate': {
      const { expression } = args;
      try {
        const result = safeEvaluateMathExpression(expression);
        return {
          expression,
          result: Number(result)
        };
      } catch (error) {
        return { error: 'Invalid mathematical expression' };
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
