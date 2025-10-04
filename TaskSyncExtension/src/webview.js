// TaskSync Chat Webview Script
(function() {
    'use strict';

    // Acquire VS Code API
    const vscode = acquireVsCodeApi();

    // Global DOM elements
    let taskInput, submitBtn, reloadBtn, fileIcon, urlIcon, messages;
    let currentFiles = [];
    let isProcessing = false;

    // Initialize when DOM is loaded
    document.addEventListener('DOMContentLoaded', function() {
        console.log('TaskSync webview initializing...');
        initializeElements();
        applyStyles();
        setupEventListeners();
        restoreState();
        vscode.postMessage({ command: 'getInitialData' });
        console.log('TaskSync webview initialized successfully');
    });

    function applyStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .message {
                display: flex;
            }
            .message-user {
                justify-content: flex-end;
            }
            .message-assistant {
                justify-content: flex-start;
            }
            .message-content {
                max-width: 80%;
                padding: 10px;
                border-radius: 10px;
                word-wrap: break-word;
                margin-bottom: 2px;
            }
            .message-user .message-content {
                background-color: #0078d4;
                color: #fff;
            }
            .message-assistant .message-content {
                background-color: #f1f1f1;
                color: #000;
            }
        `;
        document.head.appendChild(style);
    }

    function initializeElements() {
        taskInput = document.getElementById('taskInput');
        submitBtn = document.getElementById('submitBtn');
        reloadBtn = document.getElementById('reloadBtn');
        fileIcon = document.getElementById('fileIcon');
        urlIcon = document.getElementById('urlIcon');
        messages = document.getElementById('messages');

        if (!taskInput || !submitBtn || !reloadBtn || !fileIcon || !messages) {
            console.error('Failed to initialize required DOM elements');
            return;
        }

        console.log('DOM elements initialized successfully');
    }

    function setupEventListeners() {
        if (submitBtn) {
            submitBtn.addEventListener('click', submitTask);
        }

        if (reloadBtn) {
            reloadBtn.addEventListener('click', copyAndSendToCopilot);
        }

        if (fileIcon) {
            fileIcon.addEventListener('click', showFileSelector);
        }

        if (urlIcon) {
            urlIcon.addEventListener('click', extractUrlData);
        }

        if (taskInput) {
            taskInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitTask();
                }
            });
        }

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            console.log('🔍 webview: Received message:', message);
            switch (message.command) {
                case 'initialData':
                    console.log('🔍 webview: Processing initialData with', message.data.logEntries?.length || 0, 'entries:', message.data.logEntries);
                    updateChat(message.data.logEntries);
                    console.log('🔍 webview: Connection status:', message.data.connectionStatus);
                    break;
                case 'updateData':
                    console.log('🔍 webview: Processing updateData with', message.data.logEntries?.length || 0, 'entries:', message.data.logEntries);
                    // Use updateChat to preserve user messages that haven't been logged yet
                    updateChat(message.data.logEntries);
                    console.log('🔍 webview: Connection status:', message.data.connectionStatus);
                    break;
                case 'taskResult':
                    addMessage(message.content, 'assistant');
                    setProcessing(false);
                    break;
                case 'taskReceived':
                    setProcessing(false);
                    break;
                case 'error':
                    addMessage(`Error: ${message.content}`, 'error');
                    setProcessing(false);
                    break;
                case 'filesSelected':
                    showFilesSelectedNotification(message.count, message.files);
                    break;
                case 'fileReferencesAdded':
                    showFileReferencesNotification(message.count);
                    break;
                case 'urlExtractionComplete':
                    handleUrlExtractionComplete(message);
                    break;
                default:
                    console.log('🔍 webview: Unknown message command:', message.command);
            }
        });
    }

    function submitTask() {
        console.log('🔍 WEBVIEW DEBUG: submitTask function called');
        console.log('🔍 WEBVIEW DEBUG: isProcessing:', isProcessing);
        
        if (isProcessing) {
            console.log('🔍 WEBVIEW DEBUG: Already processing, returning early');
            return;
        }

        const task = taskInput.value.trim();
        console.log('🔍 WEBVIEW DEBUG: Task input value:', task);
        
        if (!task) {
            console.log('🔍 WEBVIEW DEBUG: Empty task, returning early');
            return; // Do not send empty messages
        }

        setProcessing(true);
        console.log('🔍 WEBVIEW DEBUG: Set processing to true');

        const messageData = {
            command: 'submitTask',
            data: { 
                task: task,
                category: document.getElementById('categorySelect').value,
                files: currentFiles
            }
        };
        
        console.log('🔍 WEBVIEW DEBUG: About to send message to extension:', messageData);
        console.log('🔍 WEBVIEW DEBUG: vscode object exists:', !!vscode);
        console.log('🔍 WEBVIEW DEBUG: vscode.postMessage exists:', !!vscode.postMessage);
        
        vscode.postMessage(messageData);
        console.log('🔍 WEBVIEW DEBUG: Message sent to extension successfully');

        taskInput.value = '';
        currentFiles = [];
        updateFileDisplay();
        console.log('🔍 WEBVIEW DEBUG: Cleared input and files');
        // The extension will now be responsible for adding the user message to the view
        // to ensure it's in sync with the log file.
        // addMessage(task, 'user'); 
        saveState();
        console.log('🔍 WEBVIEW DEBUG: submitTask function completed');
    }

    function copyAndSendToCopilot() {
        console.log('Copy and send to Copilot button clicked');
        const basePrompt = typeof copilotPromptContent !== 'undefined' ? copilotPromptContent : 'Error loading prompt.';

        if (basePrompt.startsWith('Error')) {
            addMessage(basePrompt, 'error');
            return;
        }

        const prompt = `${basePrompt}\n\n${taskInput.value}`;

        // Copy to clipboard
        navigator.clipboard.writeText(prompt).then(() => {
            console.log('Prompt copied to clipboard successfully');
            
            // Show visual feedback
            const originalIcon = reloadBtn.innerHTML;
            reloadBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
            reloadBtn.style.backgroundColor = '#28a745'; // Green for success
            
            setTimeout(() => {
                reloadBtn.innerHTML = originalIcon;
                reloadBtn.style.backgroundColor = ''; // Revert to original color
            }, 2000);
            
            // Also send to Copilot Chat
            sendToCopilotChat(prompt);
        }).catch(err => {
            console.error('Failed to copy to clipboard:', err);
            addMessage('Failed to copy prompt to clipboard. Sending to Copilot Chat only.', 'error');
            
            // Still try to send to Copilot Chat
            sendToCopilotChat(prompt);
        });
    }

    function sendToCopilotChat(prompt) {
        console.log('Sending prompt to Copilot Chat');
        vscode.postMessage({
            command: 'openCopilotChat',
            data: { prompt: prompt }
        });
    }



    function showFileSelector() {
        vscode.postMessage({
            command: 'showFileSelector'
        });
    }

    function extractUrlData() {
        const url = prompt('Enter the URL to extract data from:');
        if (url && url.trim()) {
            addMessage(`Extracting data from: ${url}`, 'system');
            setProcessing(true);
            vscode.postMessage({
                command: 'extractUrlData',
                data: { url: url.trim() }
            });
        }
    }

    function handleUrlExtractionComplete(message) {
        setProcessing(false);
        if (message.success) {
            addMessage(`Data extraction completed successfully! Check tasksync/extracted-data.txt for the full content.`, 'system');
        } else {
            addMessage(`Failed to extract data: ${message.error}`, 'error');
        }
    }

    // Track the number of messages currently displayed
    let currentMessageCount = 0;

    function refreshChat(logEntries) {
        console.log('🔍 refreshChat: Called with', logEntries ? logEntries.length : 0, 'entries');
        console.log('🔍 refreshChat: Clearing existing messages and rebuilding chat');
        
        if (!messages) {
            console.log('🔍 refreshChat: Messages element not found, returning early');
            return;
        }
        
        // Clear existing messages and reset counter
        messages.innerHTML = '';
        currentMessageCount = 0;
        
        if (!logEntries || logEntries.length === 0) {
            console.log('🔍 refreshChat: No entries found, showing empty state');
            messages.innerHTML = `
                <div class="empty-state">
                    <h2>Welcome to TaskSync</h2>
                    <p>Submit your first task below to get started</p>
                </div>
            `;
            return;
        }
        
        // Add all messages
        console.log('🔍 refreshChat: Adding all', logEntries.length, 'messages');
        logEntries.forEach((entry, index) => {
            console.log(`🔍 refreshChat: Adding entry ${index + 1}:`, entry);
            addMessage(entry.content, entry.type);
        });
        
        currentMessageCount = logEntries.length;
        console.log('🔍 refreshChat: Set message count to:', currentMessageCount);
    }

    function updateChat(logEntries) {
        console.log('🔍 updateChat: Called with', logEntries ? logEntries.length : 0, 'entries');
        console.log('🔍 updateChat: Current message count:', currentMessageCount);
        console.log('🔍 updateChat: Messages element exists:', !!messages);
        if (!messages) {
            console.log('🔍 updateChat: Messages element not found, returning early');
            return;
        }
        
        if (!logEntries || logEntries.length === 0) {
            console.log('🔍 updateChat: No entries found, showing empty state');
            messages.innerHTML = `
                <div class="empty-state">
                    <h2>Welcome to TaskSync</h2>
                    <p>Submit your first task below to get started</p>
                </div>
            `;
            currentMessageCount = 0;
            return;
        }

        // Remove empty state if it exists
        const emptyState = messages.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }

        // Only add new messages that haven't been displayed yet
        if (logEntries.length > currentMessageCount) {
            console.log('🔍 updateChat: Adding', logEntries.length - currentMessageCount, 'new messages');
            for (let i = currentMessageCount; i < logEntries.length; i++) {
                const entry = logEntries[i];
                console.log(`🔍 updateChat: Adding new entry ${i + 1}:`, entry);
                addMessage(entry.content, entry.type);
            }
            currentMessageCount = logEntries.length;
            console.log('🔍 updateChat: Updated message count to:', currentMessageCount);
        } else {
            console.log('🔍 updateChat: No new messages to add');
        }
    }

    function showFilesSelectedNotification(count, files) {
        const notification = document.createElement('div');
        notification.className = 'file-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <span>📋 ${count} file${count > 1 ? 's' : ''} selected (will be added when you send your message)</span>
                <button class="close-notification">×</button>
            </div>
        `;
        
        // Add styles for the notification
        const style = document.createElement('style');
        style.textContent = `
            .file-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                background-color: #007acc;
                color: white;
                padding: 10px 15px;
                border-radius: 5px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                z-index: 1000;
                animation: slideIn 0.3s ease-out;
            }
            .notification-content {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .close-notification {
                background: none;
                border: none;
                color: white;
                font-size: 16px;
                cursor: pointer;
                padding: 0;
                margin-left: 10px;
            }
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(notification);
        
        // Add close functionality
        const closeBtn = notification.querySelector('.close-notification');
        closeBtn.addEventListener('click', () => {
            notification.remove();
        });
        
        // Auto-remove after 4 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 4000);
    }

    function showFileReferencesNotification(count) {
        const notification = document.createElement('div');
        notification.className = 'file-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <span>✅ ${count} file${count > 1 ? 's' : ''} added to tasks.md</span>
                <button class="close-notification">×</button>
            </div>
        `;
        
        // Add styles for the notification
        const style = document.createElement('style');
        style.textContent = `
            .file-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                background-color: #28a745;
                color: white;
                padding: 10px 15px;
                border-radius: 5px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                z-index: 1000;
                animation: slideIn 0.3s ease-out;
            }
            .notification-content {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .close-notification {
                background: none;
                border: none;
                color: white;
                font-size: 16px;
                cursor: pointer;
                padding: 0;
                margin-left: 10px;
            }
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(notification);
        
        // Add close functionality
        const closeBtn = notification.querySelector('.close-notification');
        closeBtn.addEventListener('click', () => {
            notification.remove();
        });
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 3000);
    }

    function addMessage(content, type = 'info') {
        console.log(`🔍 addMessage: Creating message with type '${type}' and content:`, content);
        if (!messages) {
            console.log('🔍 addMessage: ERROR - messages container not found!');
            return;
        }

        // Remove empty state if it exists
        const emptyState = messages.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message message-${type}`;
        console.log(`🔍 addMessage: Set className to '${messageDiv.className}'`);
        
        const messageHTML = `
            <div class="message-content">
                <div class="message-text">${content}</div>
            </div>
        `;
        messageDiv.innerHTML = messageHTML;
        console.log(`🔍 addMessage: Set innerHTML to:`, messageHTML);
        
        messages.appendChild(messageDiv);
        console.log(`🔍 addMessage: Appended message to container. Total children now:`, messages.children.length);
        console.log(`🔍 addMessage: Message element styles:`, window.getComputedStyle(messageDiv));
        messages.scrollTop = messages.scrollHeight;
        
        saveState();
    }

    function setProcessing(processing) {
        isProcessing = processing;
        if (submitBtn) {
            submitBtn.disabled = processing;
            submitBtn.style.opacity = processing ? '0.5' : '1';
        }
    }

    function saveState() {
        const state = {
            messagesContent: messages ? messages.innerHTML : '',
            taskValue: taskInput ? taskInput.value : ''
        };
        vscode.setState(state);
    }

    function restoreState() {
        const state = vscode.getState();
        if (state) {
            if (state.messagesContent && messages) {
                messages.innerHTML = state.messagesContent;
                messages.scrollTop = messages.scrollHeight;
            }
            if (state.taskValue && taskInput) {
                taskInput.value = state.taskValue;
            }
        }
    }

    // Export functions for debugging
    window.taskSync = {
        submitTask,
        copyAndSendToCopilot,
        sendToCopilotChat,
        getCopilotPrompt,
        showFileSelector,
        addFileReference,
        addMessage
    };

})();