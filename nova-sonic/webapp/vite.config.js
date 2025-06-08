import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env file
const env = config().parsed || {};
const API_ENDPOINT = process.env.VITE_API_ENDPOINT || env.API_ENDPOINT || 'http://localhost:8000';

export default defineConfig({
  base: "./", //Use relative paths so it works at any mount path
  plugins: [
    react(),
    {
      name: 'html-transform',
      transformIndexHtml(html) {
        return html.replace('%API_ENDPOINT%', API_ENDPOINT);
      }
    }
  ],
  publicDir: "public",
  server: {
    allowedHosts: true, // Allows external connections like ngrok
    proxy: {
      // Proxy /api requests to the backend server
      "/api": {
        target: "http://0.0.0.0:7860", // Replace with your backend URL
        changeOrigin: true,
      },
    },
  },
  // Configure optimizations for AWS AppSync and related packages
  optimizeDeps: {
    include: ['aws-appsync', 'graphql-tag', 'graphql'],
    esbuildOptions: {
      // Needed to make aws-sdk work
      define: {
        global: 'globalThis',
      },
    },
  },
  // Configure build options
  build: {
    commonjsOptions: {
      transformMixedEsModules: true, // Handle mixed ES/CommonJS modules
    },
    rollupOptions: {
      // External packages that shouldn't be bundled
      external: [],
    },
  },
  // Configure resolve options
  resolve: {
    alias: {
      // Add any necessary aliases here
      'process': 'process/browser',
      'buffer': 'buffer',
    },
  },
});
