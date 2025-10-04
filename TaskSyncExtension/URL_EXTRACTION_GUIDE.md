# URL Data Extraction Feature

## Overview

The TaskSync extension now includes a powerful URL data extraction feature that allows you to fetch and analyze content from any website directly within VS Code.

## How to Use

1. **Click the Link Icon**: In the TaskSync chat interface, click the link icon (🔗) located next to the file attachment icon.

2. **Enter URL**: A prompt will appear asking you to enter the URL you want to extract data from.
   - Supports both HTTP and HTTPS protocols
   - Example: `https://example.com` or `http://example.org`

3. **Wait for Extraction**: The extension will:
   - Fetch the content from the URL
   - Follow redirects automatically (301/302 status codes)
   - Handle errors gracefully with clear error messages
   - Show progress notifications

4. **Access Extracted Data**: Once complete:
   - Full content is saved to `tasksync/extracted-data.txt` in your workspace
   - Extraction summary is logged to `tasksync/log.md`
   - Preview appears in the chat interface

## Features

### ✅ Supported
- HTTP and HTTPS protocols
- Automatic redirect following
- Custom User-Agent headers for better compatibility
- 10-second timeout protection
- Error handling for network issues
- Large file support

### ⚠️ Limitations
- Text-based content only (HTML, plain text, JSON, etc.)
- Binary files (images, PDFs) are downloaded but may not display properly
- Some websites may block automated requests
- Requires internet connection

## Use Cases

### Web Scraping for Development
```
Use Case: Extract HTML structure from a website
1. Click the link icon
2. Enter: https://your-target-website.com
3. The extracted HTML will be saved to tasksync/extracted-data.txt
4. Use it to analyze structure, test parsers, or reference in your code
```

### API Response Analysis
```
Use Case: Fetch JSON data from an API endpoint
1. Click the link icon
2. Enter: https://api.example.com/data
3. View the JSON response in extracted-data.txt
4. Use it to understand API structure or debug responses
```

### Content Research
```
Use Case: Save web content for offline reference
1. Click the link icon
2. Enter: https://documentation-site.com/article
3. Content is saved locally for later reference
4. Access it anytime without internet connection
```

## Technical Details

### Implementation
- Uses Node.js built-in `http` and `https` modules
- No external dependencies required
- Handles redirects (301/302) automatically
- Includes timeout protection (10 seconds)
- Custom User-Agent for better compatibility

### Data Storage
- **Primary File**: `tasksync/extracted-data.txt` - Full extracted content
- **Log File**: `tasksync/log.md` - Extraction metadata and preview
- **Chat Preview**: First 500 characters shown in interface

### Error Handling
The extension handles various error scenarios:
- Invalid URLs (must start with http:// or https://)
- Network errors (connection timeout, DNS failures)
- HTTP errors (404, 500, etc.)
- Request timeouts (10-second limit)

## Examples

### Example 1: Extract HTML Content
```
URL: https://example.com
Result: Full HTML page saved to tasksync/extracted-data.txt
Use: Analyze page structure, extract specific elements
```

### Example 2: Fetch API Data
```
URL: https://api.github.com/users/octocat
Result: JSON user data saved to tasksync/extracted-data.txt
Use: Test API endpoints, analyze response format
```

### Example 3: Download Documentation
```
URL: https://docs.python.org/3/
Result: Documentation HTML saved to tasksync/extracted-data.txt
Use: Offline reference, content analysis
```

## Security Notes

- Always ensure you have permission to access and extract data from websites
- Respect robots.txt and website terms of service
- Some websites may block automated requests
- Consider rate limiting when making multiple requests

## Troubleshooting

### "Invalid URL" Error
**Solution**: Ensure URL starts with `http://` or `https://`

### "Request timeout" Error
**Solution**: The website may be slow or unreachable. Try again or check your internet connection.

### "HTTP 403" or "HTTP 401" Error
**Solution**: The website is blocking automated requests. Some sites require authentication or don't allow scraping.

### "getaddrinfo ENOTFOUND" Error
**Solution**: Check the URL spelling and ensure the website exists and is reachable.

## Support

For issues, feature requests, or questions about URL extraction:
- Open an issue on [GitHub](https://github.com/4regab/TaskSync/issues)
- Include the URL you're trying to access (if applicable)
- Provide error messages from the console
