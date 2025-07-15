# Changelog

All notable changes to this project will be documented in this file.

## Version 2.0 (07-15-25)
- PowerShell word count monitoring system for efficient file change detection
- Protocol standardization: identical files, IDE-specific paths, and template system
- Fixed timing (180s/30s), mandatory Start-Sleep for monitoring, and never end session enforcement
- Multi-session log support: auto session creation, session numbering, and clear separation in log.txt
- Enhanced enforcement: session termination prevention, urgent override detection, and task continuation priority
- Improved documentation: configuration, usage, protocol, and changelog updates

## Version 1.0 (07-14-25)
- Initial release with infinite monitoring and basic file/task execution
- Dual file system: separate tasks.txt for instructions and log.txt for monitoring history
- Status logging: count-based monitoring, structured log format, and session tracking
- Manual termination only: agent never ends session automatically, explicit keywords required
- Robust error handling, improved user experience, and comprehensive documentation
