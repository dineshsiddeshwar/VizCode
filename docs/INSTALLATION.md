# Installation Instructions — VizCode

These instructions assume you have Node.js (>=14) and npm installed on your system.

1. Clone the repository or copy the source to your machine.

2. Install dependencies

```powershell
cd "c:\Users\UU363RY\OneDrive - EY\Desktop\AI DaaC"
npm install
```

3. Start the development server

```powershell
npm run dev
```

4. Open the app
- Visit http://localhost:5173/ in your browser.

Optional: Start the mock backend (if you want parsing via the backend)

```powershell
cd ollama-backend
node ollama-backend.cjs
```

Notes
- The project uses the Monaco editor for prompt editing; installation will pull `@monaco-editor/react` and related packages.
- If you see dependency errors, ensure your npm registry is accessible and try `npm cache clean --force` then `npm install` again.
- To build for production, run:

```powershell
npm run build
```

Contact
- For help: dineshks814@gmail.com
