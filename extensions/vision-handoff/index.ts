import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { complete } from "@earendil-works/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";

interface VisionConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
}

function loadVisionConfig(cwd: string): VisionConfig | null {
  // Try multiple locations in order of precedence
  const locations = [
    path.join(cwd, ".pi", "vision.json"),
    path.join(cwd, ".vision.json"),
    path.join(process.env.HOME || "", ".pi", "agent", "vision.json"),
    path.join(process.env.HOME || "", ".pi", "vision.json"),
  ];

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      try {
        const content = fs.readFileSync(loc, "utf-8");
        return JSON.parse(content) as VisionConfig;
      } catch (e) {
        console.error(`[vision-handoff] Failed to parse vision config at ${loc}:`, e);
      }
    }
  }

  return null;
}

export default function (pi: ExtensionAPI) {
  let visionConfig: VisionConfig | null = null;

  pi.on("session_start", async (_event, ctx) => {
    visionConfig = loadVisionConfig(ctx.cwd);
    if (visionConfig) {
      ctx.ui.notify(
        `Vision handoff: ${visionConfig.provider}/${visionConfig.model}`,
        "info"
      );
    } else {
      ctx.ui.notify(
        "Vision handoff: no config found (vision.json). Place in .pi/vision.json or .vision.json in project root.",
        "warning"
      );
    }
  });

  pi.registerTool({
    name: "vision_handoff",
    label: "Vision Handoff",
    description:
      "Send a prompt (with optional images) to a configured vision-capable model and return its response. Use this when you need to analyze images but the current model cannot see them.",
    promptSnippet:
      "Use vision_handoff for image analysis when the current model lacks vision capabilities",
    promptGuidelines: [
      "Use vision_handoff when you need to analyze images but cannot see them yourself",
      "Use imagePath for a single image file, or imagePaths for multiple files",
      "Include all relevant images and a clear question about what to analyze",
      "The vision model will process the images and return a detailed response",
    ],
    parameters: Type.Object({
      prompt: Type.String({
        description:
          "The text prompt/question to send to the vision model. Be specific about what you want analyzed.",
      }),
      imagePath: Type.String({
        description:
          "Path to an image file to analyze. The extension will read the file and convert it to base64.",
      }),
      imagePaths: Type.Array(
        Type.String({
          description:
            "Array of paths to image files to analyze. The extension will read each file and convert them to base64.",
        }),
        {
          description: "Optional array of image file paths",
          minItems: 0,
        }
      ),
      images: Type.Array(
        Type.String({
          description:
            "Base64-encoded image data. Can include data URL prefix (e.g., 'data:image/png;base64,...') or be raw base64.",
        }),
        {
          description: "Optional additional base64-encoded images to include with the prompt",
          minItems: 0,
        }
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!visionConfig) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: No vision model configured. Create a vision.json file with provider and model settings.",
            },
          ],
          isError: true,
        };
      }

      // Build message content
      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [];

      // Helper function to read image file and convert to base64
      const readImageFile = (imagePath: string) => {
        if (!fs.existsSync(imagePath)) {
          throw new Error(`Image file not found: ${imagePath}`);
        }
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Data = imageBuffer.toString("base64");
        const ext = path.extname(imagePath).toLowerCase();
        const mimeTypes = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".webp": "image/webp",
        };
        const mimeType = mimeTypes[ext] || "image/png";
        return { type: "image" as const, data: base64Data, mimeType };
      };

      // Handle single imagePath (file path)
      if (params.imagePath) {
        try {
          content.push(readImageFile(params.imagePath));
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error reading image file: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      }

      // Handle multiple imagePaths (array of file paths)
      if (params.imagePaths && params.imagePaths.length > 0) {
        for (const imagePath of params.imagePaths) {
          try {
            content.push(readImageFile(imagePath));
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error reading image file ${imagePath}: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                },
              ],
              isError: true,
            };
          }
        }
      }

      // Add images from base64 array
      if (params.images && params.images.length > 0) {
        for (const imgData of params.images) {
          let mimeType = "image/png";
          let base64Data = imgData.trim();

          // Handle data URL format
          if (base64Data.startsWith("data:")) {
            const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              mimeType = match[1];
              base64Data = match[2];
            }
          }

          content.push({
            type: "image",
            data: base64Data,
            mimeType,
          });
        }
      }

      // Add text prompt
      content.push({ type: "text", text: params.prompt });

      const userMessage = {
        role: "user" as const,
        content,
        timestamp: Date.now(),
      };

      try {
        // Find the target model in the registry
        const models = ctx.modelRegistry.getAll();
        const targetModel = models.find(
          (m) => m.provider === visionConfig.provider && m.id === visionConfig.model
        );

        if (!targetModel) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Vision model "${visionConfig.provider}/${visionConfig.model}" not found in model registry. Ensure it's configured in models.json.`,
              },
            ],
            isError: true,
          };
        }

        // Check if model supports vision
        if (!targetModel.input.includes("image")) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Model "${visionConfig.provider}/${visionConfig.model}" does not support image input. Configure a vision-capable model in vision.json.`,
              },
            ],
            isError: true,
          };
        }

        // Get API credentials
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(targetModel);
        if (!auth.ok || !auth.apiKey) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Failed to get API key for vision model: ${auth.ok ? "Missing API key" : auth.error}`,
              },
            ],
            isError: true,
          };
        }

        // Call the vision model
        const response = await complete(
          targetModel,
          {
            systemPrompt:
              "You are a helpful vision assistant. Analyze images carefully and provide detailed, accurate responses.",
            messages: [userMessage],
          },
          {
            apiKey: auth.apiKey,
            headers: auth.headers,
            signal: signal, // respect abort signal
          }
        );

        // Extract text content
        const textContent = response.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: textContent || "The vision model returned no text response.",
            },
          ],
          details: {
            model: `${visionConfig.provider}/${visionConfig.model}`,
            usage: response.usage,
            stopReason: response.stopReason,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Vision model error: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
