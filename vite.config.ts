import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import fs from "fs";

// Workaround for macOS EPERM on index.html (com.apple.provenance xattr in Downloads):
// intercept the indexHtml middleware and use synchronous readFileSync which bypasses
// the restriction that affects async open() in certain macOS security contexts.
function fixIndexHtmlPermission() {
  return {
    name: "fix-index-html-permission",
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url === "/" || req.url === "/index.html") {
          try {
            const html = fs.readFileSync(path.resolve(__dirname, "index.html"), "utf-8");
            server.transformIndexHtml(req.url, html).then((transformed: string) => {
              res.setHeader("Content-Type", "text/html");
              res.end(transformed);
            }).catch(next);
          } catch {
            next();
          }
          return;
        }
        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    fs: {
      strict: false,
    },
  },
  plugins: [
    fixIndexHtmlPermission(),
    react(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
