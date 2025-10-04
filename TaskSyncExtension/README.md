## TaskSync Sidebar Chat

**VS Code extension to reduce premium AI requests, and manage tasks seamlessly within your IDE.**

## What is TaskSync?

TaskSync is an **autonomous agent protocol** that creates persistent agents. Instead of typing lots of messages back and forth, you write tasks in a `tasks.md` file. Your AI agent continuously monitors this file, executes tasks autonomously, and maintains persistent operation until manually terminated.

The TaskSync extension brings this entire workflow directly into VS Code sidebar with a dedicated chat interface, file management, and custom categories.

## Features

- 🎯 **Integrated Chat Interface**: Send tasks, attach files, and view real-time updates directly within the VS Code sidebar.
- 🤖 **One-Click Agent Activation**: Initialize your AI agent with a single click.
- 📁 **Automatic File Management**: The extension automatically creates and manages `tasks.md` and `log.md` files for you.
- 📎 **File Attachment Support**: Easily reference files and folders to give your agent the context it needs.
- 🌐 **URL Data Extraction**: Extract data from any website by providing a URL (supports HTTP/HTTPS with redirect following).
- 🏷️ **Task Categorization**: Organize your work by selecting a task type (e.g., Task, Bug, Feature, Research).
- 🔄 **Real-time Synchronization**: The chat interface and underlying task files are always in sync.
- 📜 **Persistent History**: All interactions are logged, providing a complete history of your agent's work.

**Note for other IDEs:** If you have issues installing the extension in an IDE that supports VS Code extensions (like Trae), you can often install it from the `.vsix` file. For guidance, see the: [VSIX Installation Guide](https://docs.trae.ai/ide/manage-extensions).

### Development Installation

1.  Clone the repository: `git clone https://github.com/4regab/TaskSync.git`
2.  Navigate to the extension directory: `cd TaskSync/TaskSyncExtension`
3.  Install dependencies: `npm install`
4.  Press `F5` in VS Code to launch the extension in a new **Extension Development Host** window.

---

## 🛠️ How to Use

1.  **Open TaskSync Panel**: Click the TaskSync icon in the VS Code sidebar.
2.  **Initialize Agent**: Click the **Copilot button 🤖** to initialize the agent. This is only needed the first time or if the agent's session has ended.
3.  **Submit Tasks**: Type your task in the input field and press `Enter` or click the send button.
4.  **Add Context (Optional)**:
    - Use the **paperclip icon 📎** to attach relevant files or folders.
    - Use the **link icon 🔗** to extract data from a URL. Enter a URL when prompted, and the extension will:
      - Fetch the complete HTML/text content from the URL
      - Save it to `tasksync/extracted-data.txt` in your workspace
      - Log the extraction details to `tasksync/log.md`
      - Display a preview in the chat
    - Select a **category** (Task, Bug, Feature) from the dropdown.
5.  **Monitor Progress**: Watch the chat for real-time updates and responses from the agent.

Once initialized, you can continue to send tasks without needing to click the Copilot button again.

---

## ⚙️ Development

### Building the Extension

To compile the extension from source:

```bash
npm run compile
```

### Packaging the Extension

To create a `.vsix` package for distribution:

```bash
npm install -g vsce
vsce package
```

## License

This project is licensed under the [MIT License](LICENSE).
