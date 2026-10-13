# GitHub Pages deployment

The game is a static React + Three.js app. It does not need the API server or PostgreSQL to run.

## Enable hosting

1. Merge the GitHub Pages setup into the `la-pipopipette` branch.
2. Open the repository's **Settings → Pages**.
3. Under **Build and deployment**, choose **GitHub Actions** as the source.
4. In **Actions**, open **Build and deploy game to GitHub Pages**. If the first deployment ran before Pages was enabled, rerun it.

After a successful deployment, the game is available at:

https://whatifqu3stion.github.io/la-pipopipette/

Pushes to `la-pipopipette` rebuild and redeploy the game automatically. Pull requests run the typecheck and build without deploying.

## Build and preview locally

Run from the repository root with Node.js 24 and pnpm 10:

```sh
pnpm install --frozen-lockfile --filter @workspace/dots-and-boxes-3d...
pnpm --filter @workspace/dots-and-boxes-3d run typecheck
PORT=5173 BASE_PATH=/la-pipopipette/ pnpm --filter @workspace/dots-and-boxes-3d run build
PORT=5173 BASE_PATH=/la-pipopipette/ pnpm --filter @workspace/dots-and-boxes-3d run serve
```

Open http://localhost:5173/la-pipopipette/ to test the same subfolder used by Pages. Vite writes the deployment output to the root `public/` directory, which the workflow uploads.

The deployment sets `BASE_PATH` so bundled images, character videos, sounds, and the favicon resolve under `/la-pipopipette/`. For a custom domain or renamed repository, update this value to match the site's path.

The browser needs WebGL. Google Fonts, YouTube music, and the Vibe Jam heartbeat remain external services; their availability is independent of GitHub Pages.
