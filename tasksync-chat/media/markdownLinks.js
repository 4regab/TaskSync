/**
 * TaskSync markdown link helpers.
 * Keeps markdown link conversion and click routing isolated from the main webview script.
 */
(function () {
    var EXTERNAL_LINK_REGEX = /^(https?:\/\/|mailto:)/i;

    /**
     * Escape potentially dangerous characters for safe HTML attribute usage.
     */
    function escapeAttribute(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * Decode HTML entities because markdown conversion runs after HTML escaping in webview renderer.
     */
    function decodeHtmlEntities(value) {
        if (!value) {
            return '';
        }

        var textarea = document.createElement('textarea');
        textarea.innerHTML = value;
        return textarea.value;
    }

    /**
     * Find the closing parenthesis for markdown target while supporting nested parenthesis.
     */
    function findTargetEnd(text, startIndex) {
        var nestedDepth = 0;

        for (var i = startIndex; i < text.length; i++) {
            var ch = text[i];

            if (ch === '\\') {
                i++;
                continue;
            }

            if (ch === '(') {
                nestedDepth++;
                continue;
            }

            if (ch === ')') {
                if (nestedDepth === 0) {
                    return i;
                }
                nestedDepth--;
            }
        }

        return -1;
    }

    /**
     * Build a safe anchor from markdown label and target values.
     */
    function buildLink(label, rawTarget) {
        var decodedTarget = decodeHtmlEntities((rawTarget || '').trim());
        if (!decodedTarget) {
            return '[' + label + '](' + rawTarget + ')';
        }

        var isExternal = EXTERNAL_LINK_REGEX.test(decodedTarget);
        var encodedTarget = escapeAttribute(encodeURIComponent(decodedTarget));
        var linkClass = isExternal ? 'markdown-link markdown-external-link' : 'markdown-link markdown-file-link';
        var href = isExternal ? escapeAttribute(decodedTarget) : '#';
        var externalAttrs = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';

        return '<a class="' + linkClass + '" href="' + href + '" data-link-target="' + encodedTarget + '"' + externalAttrs + '>' + label + '</a>';
    }

    /**
     * Scan markdown links and replace each match using provided callback.
     */
    function walkMarkdownLinks(html, replacer) {
        var cursor = 0;
        var output = '';
        var matchIndex = 0;

        while (cursor < html.length) {
            var labelStart = html.indexOf('[', cursor);
            if (labelStart === -1) {
                output += html.substring(cursor);
                break;
            }

            var labelEndMarker = html.indexOf('](', labelStart);
            if (labelEndMarker === -1) {
                output += html.substring(cursor);
                break;
            }

            var label = html.substring(labelStart + 1, labelEndMarker);
            if (!label || label.indexOf('\n') !== -1) {
                output += html.substring(cursor, labelStart + 1);
                cursor = labelStart + 1;
                continue;
            }

            var targetStart = labelEndMarker + 2;
            var targetEnd = findTargetEnd(html, targetStart);
            if (targetEnd === -1) {
                output += html.substring(cursor, labelStart + 1);
                cursor = labelStart + 1;
                continue;
            }

            var rawTarget = html.substring(targetStart, targetEnd);
            if (!rawTarget || rawTarget.indexOf('\n') !== -1) {
                output += html.substring(cursor, targetEnd + 1);
                cursor = targetEnd + 1;
                continue;
            }

            output += html.substring(cursor, labelStart);
            output += replacer(label, rawTarget, matchIndex);
            cursor = targetEnd + 1;
            matchIndex++;
        }

        return output;
    }

    /**
     * Convert markdown links in already-escaped text to safe anchor tags.
     */
    function convertMarkdownLinks(html) {
        if (!html) {
            return '';
        }

        return walkMarkdownLinks(html, function (label, rawTarget) {
            return buildLink(label, rawTarget);
        });
    }

    /**
     * Replace markdown links with placeholders and store rendered anchors for later restore.
     */
    function tokenizeMarkdownLinks(html) {
        var tokens = [];
        var text = walkMarkdownLinks(html, function (label, rawTarget, index) {
            tokens.push(buildLink(label, rawTarget));
            return '%%MARKDOWNLINK' + index + '%%';
        });

        return {
            text: text,
            links: tokens
        };
    }

    /**
     * Restore rendered anchors from placeholders after text formatting steps complete.
     */
    function restoreTokenizedLinks(text, links) {
        if (!text || !links || links.length === 0) {
            return text;
        }

        for (var i = 0; i < links.length; i++) {
            text = text.replace('%%MARKDOWNLINK' + i + '%%', links[i]);
        }

        return text;
    }

    /**
     * Map encoded link target to a webview message for extension host handling.
     */
    function toWebviewMessage(encodedTarget) {
        if (!encodedTarget) {
            return null;
        }

        var decodedTarget = encodedTarget;
        try {
            decodedTarget = decodeURIComponent(encodedTarget);
        } catch (error) {
            // Keep original value when encoded target is malformed.
        }

        var target = decodedTarget.trim();
        if (!target) {
            return null;
        }

        if (EXTERNAL_LINK_REGEX.test(target)) {
            return { type: 'openExternal', url: target };
        }

        return { type: 'openFileLink', target: target };
    }

    window.TaskSyncMarkdownLinks = {
        convertMarkdownLinks: convertMarkdownLinks,
        tokenizeMarkdownLinks: tokenizeMarkdownLinks,
        restoreTokenizedLinks: restoreTokenizedLinks,
        toWebviewMessage: toWebviewMessage
    };
}());
