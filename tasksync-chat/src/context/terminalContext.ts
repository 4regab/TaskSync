import * as vscode from 'vscode';

/**
 * Represents a captured terminal command execution
 */
export interface TerminalCommand {
    id: string;
    command: string;
    output: string;
    exitCode: number | undefined;
    timestamp: number;
    cwd: string;
    terminalName: string;
}

/**
 * Execution tracker with timestamp for cleanup
 */
interface ExecutionTracker {
    output: string[];
    timestamp: number;
    terminalId: number;
}

/**
 * Terminal Context Provider
 * Captures and stores recent terminal command executions using VS Code Shell Integration API
 */
export class TerminalContextProvider implements vscode.Disposable {
    private _commands: TerminalCommand[] = [];
    private _maxCommands: number = 20;
    private _disposables: vscode.Disposable[] = [];
    private _activeExecutions: Map<vscode.TerminalShellExecution, ExecutionTracker> = new Map();

    // Cleanup stale executions after 60 seconds (prevents memory leak if terminal killed)
    private readonly _STALE_EXECUTION_TIMEOUT_MS = 60000;
    private _cleanupInterval: ReturnType<typeof setInterval> | null = null;

    constructor() {
        this._registerListeners();
        this._startCleanupInterval();
    }

    /**
     * Start periodic cleanup of stale execution trackers
     * Prevents memory leaks if terminal is killed without firing onDidEndTerminalShellExecution
     */
    private _startCleanupInterval(): void {
        // Check every 30 seconds for stale executions
        this._cleanupInterval = setInterval(() => {
            const now = Date.now();
            const staleEntries: vscode.TerminalShellExecution[] = [];

            for (const [execution, tracker] of this._activeExecutions) {
                if (now - tracker.timestamp > this._STALE_EXECUTION_TIMEOUT_MS) {
                    staleEntries.push(execution);
                }
            }

            for (const execution of staleEntries) {
                console.warn('[TaskSync] Cleaning up stale terminal execution tracker');
                this._activeExecutions.delete(execution);
            }
        }, 30000);
    }

    /**
     * Register terminal shell execution listeners
     */
    private _registerListeners(): void {
        // Listen for terminal shell execution start
        this._disposables.push(
            vscode.window.onDidStartTerminalShellExecution(async (event) => {
                // Create a tracker for this execution with timestamp for cleanup
                const tracker: ExecutionTracker = {
                    output: [],
                    timestamp: Date.now(),
                    terminalId: (event.terminal as any).processId || Date.now()
                };
                this._activeExecutions.set(event.execution, tracker);

                // Start reading output stream
                this._readExecutionOutput(event.execution, tracker);
            })
        );

        // Listen for terminal shell execution end
        this._disposables.push(
            vscode.window.onDidEndTerminalShellExecution((event) => {
                const tracker = this._activeExecutions.get(event.execution);
                if (tracker) {
                    // Create command entry
                    const command: TerminalCommand = {
                        id: `term_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                        command: event.execution.commandLine?.value || 'Unknown command',
                        output: this._sanitizeOutput(tracker.output.join('')),
                        exitCode: event.exitCode,
                        timestamp: Date.now(),
                        cwd: event.execution.cwd?.fsPath || '',
                        terminalName: event.terminal.name
                    };

                    // Add to command history (newest first)
                    this._commands.unshift(command);

                    // Enforce max limit
                    if (this._commands.length > this._maxCommands) {
                        this._commands = this._commands.slice(0, this._maxCommands);
                    }

                    // Clean up tracker
                    this._activeExecutions.delete(event.execution);
                }
            })
        );

        // Listen for terminal close to clean up associated executions (prevents memory leak)
        this._disposables.push(
            vscode.window.onDidCloseTerminal((terminal) => {
                // Remove all execution trackers associated with this terminal
                const terminalProcessId = (terminal as any).processId;
                const toDelete: vscode.TerminalShellExecution[] = [];

                for (const [execution, tracker] of this._activeExecutions) {
                    // Match by terminal name as fallback if processId not available
                    const executionTerminal = (execution as any).terminal;
                    if (executionTerminal === terminal ||
                        (terminalProcessId && tracker.terminalId === terminalProcessId)) {
                        toDelete.push(execution);
                    }
                }

                for (const execution of toDelete) {
                    this._activeExecutions.delete(execution);
                }
            })
        );
    }

    /**
     * Read output from terminal execution stream
     */
    private async _readExecutionOutput(
        execution: vscode.TerminalShellExecution,
        tracker: { output: string[] }
    ): Promise<void> {
        try {
            const stream = execution.read();
            for await (const data of stream) {
                tracker.output.push(data);

                // Limit output size to prevent memory issues (max 50KB per command)
                const totalLength = tracker.output.reduce((sum, s) => sum + s.length, 0);
                if (totalLength > 50000) {
                    tracker.output.push('\n... (output truncated)');
                    break;
                }
            }
        } catch (error) {
            // Stream may be closed early - not an error
            console.error('[TaskSync] Error reading terminal output:', error);
        }
    }

    /**
     * Sanitize terminal output by removing ANSI escape sequences
     */
    private _sanitizeOutput(output: string): string {
        // Remove ANSI escape codes (colors, cursor movements, etc.)
        // eslint-disable-next-line no-control-regex
        const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
        let sanitized = output.replace(ansiRegex, '');

        // Remove other common control characters
        // eslint-disable-next-line no-control-regex
        sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        // Normalize line endings
        sanitized = sanitized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Remove excessive blank lines
        sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

        return sanitized.trim();
    }

    /**
     * Get all recent commands
     */
    public getRecentCommands(): TerminalCommand[] {
        return [...this._commands];
    }

    /**
     * Get command by ID
     */
    public getCommandById(id: string): TerminalCommand | undefined {
        return this._commands.find(cmd => cmd.id === id);
    }

    /**
     * Get the most recent command
     */
    public getLatestCommand(): TerminalCommand | undefined {
        return this._commands[0];
    }

    /**
     * Format a command for inclusion in a prompt
     */
    public formatCommandForPrompt(command: TerminalCommand): string {
        const exitInfo = command.exitCode !== undefined
            ? `Exit code: ${command.exitCode}`
            : 'Running';

        const lines = [
            `=== Terminal Command ===`,
            `Command: ${command.command}`,
            `Directory: ${command.cwd || 'Unknown'}`,
            `Terminal: ${command.terminalName}`,
            `${exitInfo}`,
            ``,
            `Output:`,
            '```',
            command.output || '(no output)',
            '```'
        ];

        return lines.join('\n');
    }

    /**
     * Format all recent commands for quick reference
     */
    public formatCommandListForAutocomplete(): Array<{
        label: string;
        description: string;
        id: string;
        detail: string;
    }> {
        return this._commands.map((cmd, index) => {
            const timeAgo = this._formatTimeAgo(cmd.timestamp);
            const exitStatus = cmd.exitCode === 0 ? '✓' : cmd.exitCode !== undefined ? '✗' : '⋯';
            const outputPreview = cmd.output.substring(0, 100).replace(/\n/g, ' ');

            return {
                label: `${exitStatus} ${cmd.command}`,
                description: timeAgo,
                id: cmd.id,
                detail: outputPreview + (cmd.output.length > 100 ? '...' : '')
            };
        });
    }

    /**
     * Format timestamp as relative time
     */
    private _formatTimeAgo(timestamp: number): string {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);

        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        // Clear cleanup interval to prevent memory leaks
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }

        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
        this._commands = [];
        this._activeExecutions.clear();
    }
}
