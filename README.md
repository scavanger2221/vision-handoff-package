# Vision Handoff Extension

A pi extension that sends images to a separate vision-capable model for analysis when the current model cannot see images.

## Features

- Analyze images using a configured vision model
- Support for single or multiple image files
- Automatic file reading and base64 conversion
- Works with any vision-capable model (GPT-4V, Claude 3, etc.)

## Installation

Install as a pi package:

```bash
pi install /home/dwi/Project/vision-handoff-package
```

Or install from a git repository after publishing.

## Setup

Create a `vision.json` configuration file in your project root or `.pi/` directory:

```json
{
  "provider": "anthropic",
  "model": "claude-3-5-sonnet-20241022",
  "apiKey": "your-api-key-here"
}
```

Or place it in `~/.pi/vision.json` for global configuration.

**Configuration options:**
- `provider` - Provider name (e.g., "anthropic", "openai", "google")
- `model` - Model ID that supports vision (must have "image" in input capabilities)
- `baseUrl` - Optional custom base URL for the provider
- `api` - Optional API type override
- `apiKey` - Optional API key (can also use environment variables or auth storage)

## Usage

The extension registers a `vision_handoff` tool that the LLM can use when it needs to analyze images but cannot see them itself.

### Tool Parameters

- **`prompt`** (required): Text prompt/question to send to the vision model
- **`imagePath`**: Single image file path
- **`imagePaths`**: Array of image file paths (for multiple images)
- **`images`**: Array of base64-encoded image data (advanced use)

### Examples

**Single image:**
```typescript
vision_handoff({
  prompt: "What's in this image?",
  imagePath: "/path/to/image.png"
})
```

**Multiple images:**
```typescript
vision_handoff({
  prompt: "Compare these images and describe the differences",
  imagePaths: ["/path/to/image1.png", "/path/to/image2.jpg"]
})
```

**With existing base64 data:**
```typescript
vision_handoff({
  prompt: "Analyze this image",
  images: ["data:image/png;base64,iVBORw0KGgo..."]
})
```

## How It Works

1. LLM determines it needs to analyze an image but can't see it
2. LLM calls `vision_handoff` tool with file paths and prompt
3. Extension reads files, converts to base64
4. Extension sends to configured vision model
5. Vision model's analysis is returned to the LLM

## Supported Image Formats

- PNG (.png)
- JPEG (.jpg, .jpeg)
- GIF (.gif)
- WebP (.webp)

## Notes

- The extension will show a notification on session start if a vision model is configured
- If no config is found, the tool returns an error
- The tool checks that the configured model supports image input
- API keys are resolved via the same auth system as pi (environment variables, auth.json, etc.)

## License

MIT
