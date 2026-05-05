# electron-shadcn

Electron in all its glory. Everything you will need to develop your beautiful desktop application.

![Demo GIF](https://github.com/LuanRoger/electron-shadcn/blob/main/images/demo.png)

## Libs and tools

To develop a Electron app, you probably will need some UI, test, formatter, style or other kind of library or framework, so let me install and configure some of them to you.

### Core 🏍️

- [Electron 41](https://www.electronjs.org)
- [Vite 8](https://vitejs.dev)

### DX 🛠️

- [TypeScript 5.9](https://www.typescriptlang.org)
- [oRPC](https://orpc.unnoq.com)
- [Prettier](https://prettier.io)
- [Ultracite with Biome](https://www.ultracite.ai/providers/biome)
- [Zod 4](https://zod.dev)
- [React Query (TanStack)](https://react-query.tanstack.com)

### UI 🎨

- [React 19.2](https://reactjs.org)
- [Tailwind 4](https://tailwindcss.com)
- [Shadcn UI](https://ui.shadcn.com)
- [Geist](https://vercel.com/font) as default font
- [i18next](https://www.i18next.com)
- [TanStack Router](https://tanstack.com/router) (with file based routing)
- [Lucide](https://lucide.dev)

### Test 🧪

- [Vitest](https://vitest.dev)
- [Playwright](https://playwright.dev)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro)

### Packing and distribution 📦

- [Electron Forge](https://www.electronforge.io)

### CI/CD 🚀

- Pre-configured [GitHub Actions workflow](https://github.com/LuanRoger/electron-shadcn/blob/main/.github/workflows/playwright.yml), for test with Playwright

### Project preferences 🎯

- Use Context isolation
- [React Compiler](https://react.dev/learn/react-compiler) is enabled by default.
- `titleBarStyle`: hidden (Using custom title bar)
- Geist as default font
- Some default styles was applied, check the [`styles`](https://github.com/LuanRoger/electron-shadcn/tree/main/src/styles) directory
- React DevTools are installed by default

## How to use

1. Clone this repository

```bash
git clone https://github.com/LuanRoger/electron-shadcn.git
```

Or use it as a template on GitHub

2. Install dependencies

```bash
bun install
```

3. Run the app

```bash
bun run start
```

Now you can go directly to `/src/routes/index.tsx` and modify the app as you want.

> You can also delete the `/src/routes/second.tsx` file if you don't want a second page.

## Auto update (Cloudflare R2 + StaticStorage)

The app uses `update-electron-app` with `UpdateSourceType.StaticStorage`.

Set runtime env var:

- `UPDATE_BASE_URL=https://updates.MEU_DOMINIO.com/updates`

The app resolves platform URL as:

- `${UPDATE_BASE_URL}/${process.platform}/${process.arch}`

Example resolved URLs:

- `https://updates.MEU_DOMINIO.com/updates/win32/x64`
- `https://updates.MEU_DOMINIO.com/updates/darwin/arm64`

### Required R2 file layout

```
updates/
  win32/
    x64/
      RELEASES
      TarsDB-0.0.2-full.nupkg
      TarsDB Setup 0.0.2.exe
  darwin/
    arm64/
      RELEASES.json
      TarsDB-darwin-arm64-0.0.2.zip
```

`RELEASES` (Windows) and `RELEASES.json` (macOS) are the manifests read by `update-electron-app` static storage.

Example `RELEASES.json` (macOS):

```json
{
  "currentRelease": "TarsDB-darwin-arm64-0.0.2.zip",
  "releases": [
    {
      "updateTo": {
        "name": "TarsDB-darwin-arm64-0.0.2.zip",
        "version": "0.0.2",
        "pub_date": "2026-05-05T12:00:00.000Z",
        "notes": "Bug fixes"
      }
    }
  ]
}
```

### Build and upload

```bash
# URL que o app usa para checar updates
export UPDATE_BASE_URL="https://updates.MEU_DOMINIO.com/updates"

bun run make
bash scripts/upload-r2-updates.sh
```

Required upload env vars: `R2_BUCKET`, `R2_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

### Onde configurar a URL do R2

- **Runtime do app (obrigatório em produção):** `UPDATE_BASE_URL`
- **CI (GitHub Actions):** Secret `UPDATE_BASE_URL` (mesmo valor)

Exemplo:

`https://updates.MEU_DOMINIO.com/updates`

## Documentation

Check out the full documentation [here](https://docs.luanroger.dev/electron-shadcn).

## Used by

- [yaste](https://github.com/LuanRoger/yaste) - yaste (Yet another super ₛᵢₘₚₗₑ text editor) is a text editor, that can be used as an alternative to the native text editor of your SO, maybe.
- [eletric-drizzle](https://github.com/LuanRoger/electric-drizzle) - shadcn-ui and Drizzle ORM with Electron.
- [Wordle Game](https://github.com/masonyekta/wordle-game) - A Wordle game which features interactive gameplay, cross-platform compatibility, and integration with a custom Wordle API for word validation and letter correctness.
- [Mehr 🌟](https://github.com/xmannii/MehrLocalChat) - A modern, elegant local AI chatbot application using Electron, React, shadcn/ui, and Ollama.

> Does you've used this template in your project? Add it here and open a PR.

## License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/LuanRoger/electron-shadcn/blob/main/LICENSE) file for details.
