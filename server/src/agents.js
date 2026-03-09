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
        // Safe evaluation limited to basic math
        const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '');
        const result = Function(`'use strict'; return (${sanitized})`)();
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
