/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { create } from 'zustand';
import { customerSupportTools } from './tools/customer-support';
import { personalAssistantTools } from './tools/personal-assistant';
import { navigationSystemTools } from './tools/navigation-system';
import { whatsappTools } from './tools/whatsapp';
import { FunctionResponseScheduling } from '@google/genai';

export const workspaceTools: FunctionCall[] = [
  {
    name: "list_drive_files",
    description: "Lists files from the user's Google Drive.",
    parameters: {
      type: "OBJECT",
      properties: {
        pageSize: { type: "NUMBER", description: "Number of files to return." },
        q: { type: "STRING", description: "Search query (e.g., name contains 'Q1')." }
      }
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: "read_google_doc",
    description: "Reads the content of a Google Doc.",
    parameters: {
      type: "OBJECT",
      properties: {
        documentId: { type: "STRING", description: "The ID of the document." }
      },
      required: ["documentId"]
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: "read_spreadsheet",
    description: "Reads data from a Google Sheet.",
    parameters: {
      type: "OBJECT",
      properties: {
        spreadsheetId: { type: "STRING", description: "The ID of the spreadsheet." },
        range: { type: "STRING", description: "The A1 notation of the range to read (e.g., 'Sheet1!A1:B10')." }
      },
      required: ["spreadsheetId", "range"]
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: "list_contacts",
    description: "Lists the user's Google Contacts.",
    parameters: {
      type: "OBJECT",
      properties: {
        pageSize: { type: "NUMBER", description: "Number of contacts to return." }
      }
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: "list_tasks",
    description: "Lists the user's tasks from Google Tasks.",
    parameters: {
      type: "OBJECT",
      properties: {
        tasklist: { type: "STRING", description: "The ID of the task list (default: '@default')." }
      }
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: "send_chat_message",
    description: "Sends a message to a Google Chat space.",
    parameters: {
      type: "OBJECT",
      properties: {
        spaceName: { type: "STRING", description: "The name/ID of the space (e.g., 'spaces/AAAAAAAA')." },
        text: { type: "STRING", description: "The message content." }
      },
      required: ["spaceName", "text"]
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: "create_meet_link",
    description: "Creates a Google Meet link by scheduling a quick calendar event.",
    parameters: {
      type: "OBJECT",
      properties: {
        summary: { type: "STRING", description: "The title of the meeting." }
      },
      required: ["summary"]
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: "fetch_google_api",
    description: "Fetches data from Google APIs. The AI decides the correct Google API endpoint URL based on what the user wants to fetch (e.g., https://www.googleapis.com/calendar/v3/calendars/primary/events for Calendar; https://gmail.googleapis.com/gmail/v1/users/me/messages for Gmail). Use this to read, create, update, or delete Google Workspace data. It operates with the user's accessToken. If doing a mutating operation, make sure the user has given consent.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        url: {
          type: "STRING",
          description: "The full URL endpoint to fetch from Google API. e.g. https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=2024-01-01T00:00:00Z"
        },
        method: {
          type: "STRING",
          description: "HTTP Method, e.g. GET, POST, PUT, DELETE, PATCH"
        },
        body: {
          type: "OBJECT",
          description: "Optional JSON body for POST/PUT requests."
        }
      },
      required: ["url", "method"]
    }
  },
  {
    name: "save_memory",
    description: "Proactively stores important information to long-term memory (personal, work, project). Beatrice does this automatically when key decisions, preferences, or project details are discussed.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        memory: {
          type: "STRING",
          description: "Clear, concise sentence or two summarizing what to remember."
        },
        type: {
          type: "STRING",
          description: "Type of memory: 'personal', 'work', or 'project'."
        }
      },
      required: ["memory", "type"]
    }
  },
  {
    name: "search_memories",
    description: "Searches stored memories for relevant context about the user.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING" }
      },
      required: ["query"]
    }
  },
  {
    name: "save_note",
    description: "Saves a permanent note for the user. Use this when the user wants to 'write something down', 'take a note', or 'save this info for later'.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" },
        content: { type: "STRING" }
      },
      required: ["title", "content"]
    }
  },
  {
    name: "list_notes",
    description: "Lists all saved notes for the user.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "read_note",
    description: "Reads a previously saved note by Title.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" }
      },
      required: ["title"]
    }
  },
  {
    name: "get_user_location",
    description: "Retrieves the user's current GPS location via the browser.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "open_overlay",
    description: "Opens a specific overlay panel in the UI (e.g. for user input, settings, or external integrations).",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        overlay_id: { 
          type: "STRING", 
          enum: ["profile", "settings", "history", "tools", "whatsapp", "scanner", "meet", "map", "picker"],
          description: "The ID of the overlay to open."
        }
      },
      required: ["overlay_id"]
    }
  },
  {
    name: "generate_artifact",
    description: "Generates a visual document or data artifact (like a report, code snippet, chart, or structured document) to be displayed to the user. Use this when the user asks to create a document, write code, or generate a detailed report.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        title: {
          type: "STRING",
          description: "The title of the artifact"
        },
        type: {
          type: "STRING",
          description: "The type of artifact: 'markdown', 'code', 'chart', 'structured', 'html'"
        },
        content: {
          type: "STRING",
          description: "The actual content of the artifact (Markdown string, code, or JSON data for charts)"
        },
        language: {
          type: "STRING",
          description: "If type is 'code', the programming language"
        }
      },
      required: ["title", "type", "content"]
    }
  },
  {
    name: "google_search",
    description: "Performs a Google Search to get real-time information from the web.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING" }
      },
      required: ["query"]
    }
  },
  {
    name: "calculate",
    description: "Evaluates math expressions.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        expression: { type: "STRING" }
      },
      required: ["expression"]
    }
  },
  {
    name: "get_current_datetime",
    description: "Returns current local date, time, and timezone.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "open_browser_url",
    description: "Opens a URL in the user's default browser.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        url: { type: "STRING" }
      },
      required: ["url"]
    }
  },
  {
    name: "create_project_brief",
    description: "Generates a structured project brief (goal, audience, features, risks, next steps).",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" },
        content: { type: "STRING" }
      },
      required: ["title", "content"]
    }
  },
  {
    name: "create_checklist",
    description: "Creates an interactive checklist from a list of tasks.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" },
        items: { type: "ARRAY", items: { type: "STRING" } }
      },
      required: ["title", "items"]
    }
  },
  {
    name: "extract_tasks",
    description: "Extracts action items from freeform text into a checklist.",
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
    parameters: {
      type: "OBJECT",
      properties: {
        text: { type: "STRING" }
      },
      required: ["text"]
    }
  }
];

export type Template = 'customer-support' | 'personal-assistant' | 'navigation-system';

const toolsets: Record<Template, FunctionCall[]> = {
  'customer-support': [...workspaceTools, ...whatsappTools],
  'personal-assistant': [...personalAssistantTools, ...workspaceTools, ...whatsappTools],
  'navigation-system': [...workspaceTools, ...whatsappTools],
};

const systemPrompts: Record<Template, string> = {
  'customer-support': 'How does it react? Friendly, patient, and solutions-oriented. How does it respond? Concisely, with clear steps and empathy for customer frustrations.',
  'personal-assistant': 'How does it react? Proactive, highly organized, and intuitive. How does it respond? With efficiency, anticipating needs and managing complexity with ease.',
  'navigation-system': 'How does it react? Precise, calm, and safety-conscious. How does it respond? Giving crystal clear directions and real-time situational awareness.',
};
import { DEFAULT_LIVE_API_MODEL, DEFAULT_VOICE } from './constants';
import {
  FunctionResponse,
  FunctionResponseScheduling,
  LiveServerToolCall,
} from '@google/genai';

/**
 * Settings
 */
export const useSettings = create<{
  systemPrompt: string;
  personaName: string;
  userCallName: string;
  model: string;
  voice: string;
  language: string;
  setSystemPrompt: (prompt: string) => void;
  setPersonaName: (name: string) => void;
  setUserCallName: (name: string) => void;
  setModel: (model: string) => void;
  setVoice: (voice: string) => void;
  setLanguage: (lang: string) => void;
}>(set => ({
  systemPrompt: `How does it react? Emotionally believable, easy to talk to in live voice conversation. How does it respond? Like a person with presence, timing, texture, judgment, and conversational instinct.`,
  personaName: 'Beatrice',
  userCallName: 'Boss',
  model: DEFAULT_LIVE_API_MODEL,
  voice: DEFAULT_VOICE,
  language: 'English',
  setSystemPrompt: prompt => set({ systemPrompt: prompt }),
  setPersonaName: name => set({ personaName: name }),
  setUserCallName: name => set({ userCallName: name }),
  setModel: model => set({ model }),
  setVoice: voice => set({ voice }),
  setLanguage: lang => set({ language: lang }),
}));

/**
 * UI
 */
export const useUI = create<{
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  activeWorkspaceResult: any;
  setActiveWorkspaceResult: (result: any) => void;
  activeOverlay: string | null;
  setActiveOverlay: (overlay: string | null) => void;
}>(set => ({
  isSidebarOpen: true,
  toggleSidebar: () => set(state => ({ isSidebarOpen: !state.isSidebarOpen })),
  activeWorkspaceResult: null,
  setActiveWorkspaceResult: (result) => set({ activeWorkspaceResult: result }),
  activeOverlay: null,
  setActiveOverlay: (overlay) => set({ activeOverlay: overlay }),
}));

/**
 * Tools
 */
export interface FunctionCall {
  name: string;
  description?: string;
  parameters?: any;
  isEnabled: boolean;
  scheduling?: FunctionResponseScheduling;
}



export const useTools = create<{
  tools: FunctionCall[];
  template: Template;
  setTemplate: (template: Template) => void;
  toggleTool: (toolName: string) => void;
  addTool: () => void;
  removeTool: (toolName: string) => void;
  updateTool: (oldName: string, updatedTool: FunctionCall) => void;
}>(set => ({
  tools: personalAssistantTools,
  template: 'personal-assistant',
  setTemplate: (template: Template) => {
    set({ tools: toolsets[template], template });
    useSettings.getState().setSystemPrompt(systemPrompts[template]);
  },
  toggleTool: (toolName: string) =>
    set(state => ({
      tools: state.tools.map(tool =>
        tool.name === toolName ? { ...tool, isEnabled: !tool.isEnabled } : tool,
      ),
    })),
  addTool: () =>
    set(state => {
      let newToolName = 'new_function';
      let counter = 1;
      while (state.tools.some(tool => tool.name === newToolName)) {
        newToolName = `new_function_${counter++}`;
      }
      return {
        tools: [
          ...state.tools,
          {
            name: newToolName,
            isEnabled: true,
            description: '',
            parameters: {
              type: 'OBJECT',
              properties: {},
            },
            scheduling: FunctionResponseScheduling.INTERRUPT,
          },
        ],
      };
    }),
  removeTool: (toolName: string) =>
    set(state => ({
      tools: state.tools.filter(tool => tool.name !== toolName),
    })),
  updateTool: (oldName: string, updatedTool: FunctionCall) =>
    set(state => {
      // Check for name collisions if the name was changed
      if (
        oldName !== updatedTool.name &&
        state.tools.some(tool => tool.name === updatedTool.name)
      ) {
        console.warn(`Tool with name "${updatedTool.name}" already exists.`);
        // Prevent the update by returning the current state
        return state;
      }
      return {
        tools: state.tools.map(tool =>
          tool.name === oldName ? updatedTool : tool,
        ),
      };
    }),
}));

/**
 * Logs
 */
export interface LiveClientToolResponse {
  functionResponses?: FunctionResponse[];
}
export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export interface ConversationTurn {
  timestamp: Date;
  role: 'user' | 'agent' | 'system';
  text: string;
  isFinal: boolean;
  toolUseRequest?: LiveServerToolCall;
  toolUseResponse?: LiveClientToolResponse;
  groundingChunks?: GroundingChunk[];
}

export const useLogStore = create<{
  turns: ConversationTurn[];
  addTurn: (turn: Omit<ConversationTurn, 'timestamp'>) => void;
  updateLastTurn: (update: Partial<ConversationTurn>) => void;
  clearTurns: () => void;
}>((set, get) => ({
  turns: [],
  addTurn: (turn: Omit<ConversationTurn, 'timestamp'>) =>
    set(state => ({
      turns: [...state.turns, { ...turn, timestamp: new Date() }],
    })),
  updateLastTurn: (update: Partial<Omit<ConversationTurn, 'timestamp'>>) => {
    set(state => {
      if (state.turns.length === 0) {
        return state;
      }
      const newTurns = [...state.turns];
      const lastTurn = { ...newTurns[newTurns.length - 1], ...update };
      newTurns[newTurns.length - 1] = lastTurn;
      return { turns: newTurns };
    });
  },
  clearTurns: () => set({ turns: [] }),
}));
