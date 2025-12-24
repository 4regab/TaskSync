import * as vscode from 'vscode';

/**
 * Represents a problem/diagnostic from the workspace
 */
export interface ProblemInfo {
    id: string;
    file: string;
    relativePath: string;
    line: number;
    column: number;
    message: string;
    severity: 'error' | 'warning' | 'info' | 'hint';
    source?: string;
    code?: string | number;
}

/**
 * Problems summary for quick display
 */
export interface ProblemsSummary {
    errorCount: number;
    warningCount: number;
    infoCount: number;
    hintCount: number;
    totalCount: number;
    fileCount: number;
}

/**
 * Problems Context Provider
 * Retrieves workspace diagnostics (errors, warnings) from the Problems panel
 */
export class ProblemsContextProvider {

    /**
     * Get all problems from the workspace
     */
    public getProblems(options?: {
        severity?: ('error' | 'warning' | 'info' | 'hint')[];
        maxProblems?: number;
        filePattern?: string;
    }): ProblemInfo[] {
        const diagnostics = vscode.languages.getDiagnostics();
        const problems: ProblemInfo[] = [];
        const maxProblems = options?.maxProblems || 100;
        const severityFilter = options?.severity || ['error', 'warning', 'info', 'hint'];

        for (const [uri, fileDiagnostics] of diagnostics) {
            // Skip if file pattern doesn't match
            if (options?.filePattern) {
                const relativePath = vscode.workspace.asRelativePath(uri);
                if (!relativePath.includes(options.filePattern)) {
                    continue;
                }
            }

            for (const diagnostic of fileDiagnostics) {
                const severity = this._mapSeverity(diagnostic.severity);

                // Filter by severity
                if (!severityFilter.includes(severity)) {
                    continue;
                }

                const problem: ProblemInfo = {
                    id: `prob_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                    file: uri.fsPath,
                    relativePath: vscode.workspace.asRelativePath(uri),
                    line: diagnostic.range.start.line + 1, // 1-based for display
                    column: diagnostic.range.start.character + 1,
                    message: diagnostic.message,
                    severity: severity,
                    source: diagnostic.source,
                    code: typeof diagnostic.code === 'object'
                        ? diagnostic.code.value
                        : diagnostic.code
                };

                problems.push(problem);

                // Limit number of problems
                if (problems.length >= maxProblems) {
                    break;
                }
            }

            if (problems.length >= maxProblems) {
                break;
            }
        }

        // Sort by severity (errors first) then by file
        return problems.sort((a, b) => {
            const severityOrder = { error: 0, warning: 1, info: 2, hint: 3 };
            const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
            if (severityDiff !== 0) return severityDiff;
            return a.relativePath.localeCompare(b.relativePath);
        });
    }

    /**
     * Get problems summary for quick display
     */
    public getSummary(): ProblemsSummary {
        const diagnostics = vscode.languages.getDiagnostics();
        let errorCount = 0;
        let warningCount = 0;
        let infoCount = 0;
        let hintCount = 0;
        const filesWithProblems = new Set<string>();

        for (const [uri, fileDiagnostics] of diagnostics) {
            if (fileDiagnostics.length > 0) {
                filesWithProblems.add(uri.fsPath);
            }

            for (const diagnostic of fileDiagnostics) {
                switch (diagnostic.severity) {
                    case vscode.DiagnosticSeverity.Error:
                        errorCount++;
                        break;
                    case vscode.DiagnosticSeverity.Warning:
                        warningCount++;
                        break;
                    case vscode.DiagnosticSeverity.Information:
                        infoCount++;
                        break;
                    case vscode.DiagnosticSeverity.Hint:
                        hintCount++;
                        break;
                }
            }
        }

        return {
            errorCount,
            warningCount,
            infoCount,
            hintCount,
            totalCount: errorCount + warningCount + infoCount + hintCount,
            fileCount: filesWithProblems.size
        };
    }

    /**
     * Format problems for inclusion in a prompt
     */
    public formatProblemsForPrompt(problems?: ProblemInfo[]): string {
        const problemList = problems || this.getProblems();

        if (problemList.length === 0) {
            return '=== Workspace Problems ===\nNo problems found in the workspace.';
        }

        const summary = this.getSummary();
        const lines: string[] = [
            '=== Workspace Problems ===',
            `Summary: ${summary.errorCount} errors, ${summary.warningCount} warnings, ${summary.infoCount} info in ${summary.fileCount} files`,
            ''
        ];

        // Group by file
        const byFile = new Map<string, ProblemInfo[]>();
        for (const problem of problemList) {
            const existing = byFile.get(problem.relativePath) || [];
            existing.push(problem);
            byFile.set(problem.relativePath, existing);
        }

        for (const [filePath, fileProblems] of byFile) {
            lines.push(`📁 ${filePath}`);
            for (const problem of fileProblems) {
                const icon = this._getSeverityIcon(problem.severity);
                const source = problem.source ? `[${problem.source}]` : '';
                const code = problem.code ? `(${problem.code})` : '';
                lines.push(`  ${icon} Line ${problem.line}: ${problem.message} ${source}${code}`);
            }
            lines.push('');
        }

        return lines.join('\n').trim();
    }

    /**
     * Format for autocomplete display
     */
    public formatForAutocomplete(): {
        label: string;
        description: string;
        detail: string;
    } {
        const summary = this.getSummary();

        if (summary.totalCount === 0) {
            return {
                label: '#problems',
                description: 'No problems',
                detail: 'Workspace has no errors or warnings'
            };
        }

        const parts: string[] = [];
        if (summary.errorCount > 0) parts.push(`${summary.errorCount} errors`);
        if (summary.warningCount > 0) parts.push(`${summary.warningCount} warnings`);

        return {
            label: '#problems',
            description: parts.join(', '),
            detail: `Include ${summary.totalCount} problems from ${summary.fileCount} files`
        };
    }

    /**
     * Map VS Code DiagnosticSeverity to string
     */
    private _mapSeverity(severity: vscode.DiagnosticSeverity): 'error' | 'warning' | 'info' | 'hint' {
        switch (severity) {
            case vscode.DiagnosticSeverity.Error:
                return 'error';
            case vscode.DiagnosticSeverity.Warning:
                return 'warning';
            case vscode.DiagnosticSeverity.Information:
                return 'info';
            case vscode.DiagnosticSeverity.Hint:
                return 'hint';
            default:
                return 'info';
        }
    }

    /**
     * Get icon for severity
     */
    private _getSeverityIcon(severity: 'error' | 'warning' | 'info' | 'hint'): string {
        switch (severity) {
            case 'error':
                return '❌';
            case 'warning':
                return '⚠️';
            case 'info':
                return 'ℹ️';
            case 'hint':
                return '💡';
            default:
                return '•';
        }
    }
}
