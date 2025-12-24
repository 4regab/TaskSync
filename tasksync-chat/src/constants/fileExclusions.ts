/**
 * Common file and folder exclusion patterns for workspace searches
 * Used for file search, attachment picker, and other file operations
 * to filter out unwanted files like node_modules, build outputs, etc.
 */
export const FILE_EXCLUSION_PATTERNS = [
    '**/node_modules/**',
    '**/venv/**',
    '**/.venv/**',
    '**/env/**',
    '**/__pycache__/**',
    '**/.pytest_cache/**',
    '**/site-packages/**',
    '**/.vscode/**',
    '**/.idea/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/out/**',
    '**/target/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/vendor/**',
    '**/bower_components/**'
];

/**
 * Extended exclusion patterns for file search (includes specific files)
 */
export const FILE_SEARCH_EXCLUSION_PATTERNS = [
    ...FILE_EXCLUSION_PATTERNS,
    '**/*.log',
    '**/.env',
    '**/.env.*',
    '**/*instructions.md',
    '**/*.vsix',
    '**/*.min.js',
    '**/*.min.css',
    '**/package-lock.json',
    '**/yarn.lock',
    '**/pnpm-lock.yaml',
    '**/Cargo.lock',
    '**/poetry.lock',
    '**/Pipfile.lock'
];

/**
 * Generate glob pattern string from array of patterns
 * @param patterns - Array of glob patterns
 * @returns Formatted glob pattern string for VS Code workspace.findFiles
 */
export function formatExcludePattern(patterns: string[]): string {
    return '{' + patterns.join(',') + '}';
}
