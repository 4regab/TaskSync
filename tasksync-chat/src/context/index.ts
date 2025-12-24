/**
 * Context Module - Provides contextual information for AI prompts
 * 
 * This module provides two context providers:
 * - TerminalContextProvider: Captures recent terminal command executions
 * - ProblemsContextProvider: Retrieves workspace diagnostics (errors/warnings)
 */

export { TerminalContextProvider, TerminalCommand } from './terminalContext';
export { ProblemsContextProvider, ProblemInfo, ProblemsSummary } from './problemsContext';

import { TerminalContextProvider } from './terminalContext';
import { ProblemsContextProvider } from './problemsContext';

/**
 * Context reference types for autocomplete
 */
export type ContextReferenceType = 'terminal' | 'problems';

/**
 * Context reference for attachment
 */
export interface ContextReference {
    id: string;
    type: ContextReferenceType;
    label: string;
    content: string;
    metadata?: Record<string, unknown>;
}

/**
 * Unified Context Manager
 * Manages all context providers and provides a unified API for context retrieval
 */
export class ContextManager {
    private _terminalProvider: TerminalContextProvider;
    private _problemsProvider: ProblemsContextProvider;

    constructor() {
        this._terminalProvider = new TerminalContextProvider();
        this._problemsProvider = new ProblemsContextProvider();
    }

    /**
     * Get terminal context provider
     */
    public get terminal(): TerminalContextProvider {
        return this._terminalProvider;
    }

    /**
     * Get problems context provider
     */
    public get problems(): ProblemsContextProvider {
        return this._problemsProvider;
    }

    /**
     * Get autocomplete suggestions for # references (terminal, problems)
     */
    public async getContextSuggestions(query: string): Promise<Array<{
        type: ContextReferenceType;
        label: string;
        description: string;
        detail: string;
    }>> {
        const suggestions: Array<{
            type: ContextReferenceType;
            label: string;
            description: string;
            detail: string;
        }> = [];

        const lowerQuery = query.toLowerCase().replace('@', '');

        // Terminal suggestions
        if ('terminal'.includes(lowerQuery) || lowerQuery.startsWith('term')) {
            const commands = this._terminalProvider.formatCommandListForAutocomplete();
            if (commands.length > 0) {
                suggestions.push({
                    type: 'terminal',
                    label: '#terminal',
                    description: `${commands.length} recent commands`,
                    detail: 'Include recent terminal command outputs'
                });
            } else {
                suggestions.push({
                    type: 'terminal',
                    label: '#terminal',
                    description: 'No commands yet',
                    detail: 'Run commands in terminal to capture output'
                });
            }
        }

        // Problems suggestions
        if ('problems'.includes(lowerQuery) || lowerQuery.startsWith('prob')) {
            const problemsInfo = this._problemsProvider.formatForAutocomplete();
            suggestions.push({
                type: 'problems',
                label: problemsInfo.label,
                description: problemsInfo.description,
                detail: problemsInfo.detail
            });
        }

        return suggestions;
    }

    /**
     * Get context content by type
     */
    public async getContextContent(type: ContextReferenceType, options?: Record<string, unknown>): Promise<ContextReference | null> {
        const id = `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        switch (type) {
            case 'terminal': {
                const commandId = options?.commandId as string | undefined;
                if (commandId) {
                    const command = this._terminalProvider.getCommandById(commandId);
                    if (command) {
                        return {
                            id,
                            type,
                            label: `Terminal: ${command.command}`,
                            content: this._terminalProvider.formatCommandForPrompt(command),
                            metadata: { commandId: command.id }
                        };
                    }
                } else {
                    // Return latest command
                    const latest = this._terminalProvider.getLatestCommand();
                    if (latest) {
                        return {
                            id,
                            type,
                            label: `Terminal: ${latest.command}`,
                            content: this._terminalProvider.formatCommandForPrompt(latest),
                            metadata: { commandId: latest.id }
                        };
                    }
                }
                return null;
            }

            case 'problems': {
                const problems = this._problemsProvider.getProblems();
                if (problems.length === 0) {
                    return null;
                }
                return {
                    id,
                    type,
                    label: `Problems (${problems.length})`,
                    content: this._problemsProvider.formatProblemsForPrompt(problems)
                };
            }

            default:
                return null;
        }
    }

    /**
     * Dispose all providers
     */
    public dispose(): void {
        this._terminalProvider.dispose();
    }
}
