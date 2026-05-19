/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { FunctionResponseScheduling } from '@google/genai';
import { FunctionCall } from './state';
import { personalAssistantTools } from './tools/personal-assistant';
import { workspaceTools } from './tools/workspace';

export const AVAILABLE_TOOLS: FunctionCall[] = [
  ...personalAssistantTools,
  ...workspaceTools
];
