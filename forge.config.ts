import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { PublisherGithub } from "@electron-forge/publisher-github";
import type { ForgeConfig } from "@electron-forge/shared-types";

const updateBaseUrl = process.env.UPDATE_BASE_URL?.trim().replace(/\/+$/, "");
const updateChannel = process.env.UPDATE_CHANNEL?.trim() || "stable";
const winRemoteReleases = updateBaseUrl
  ? `${updateBaseUrl}/${updateChannel}/win32/${process.arch}`
  : undefined;
const macUpdateManifestBaseUrl = updateBaseUrl
  ? `${updateBaseUrl}/${updateChannel}/darwin/${process.arch}`
  : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    icon: "./icons/app-icon",
    asar: {
      unpack: "{**/node_modules/embedded-postgres/**,**/node_modules/@embedded-postgres/**,**/node_modules/better-sqlite3/**}",
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      ...(winRemoteReleases ? { remoteReleases: winRemoteReleases } : {}),
    }),
    new MakerZIP(
      {
        ...(macUpdateManifestBaseUrl
          ? { macUpdateManifestBaseUrl }
          : {}),
      },
      ["darwin"],
    ),
    new MakerDMG({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: process.env.GH_OWNER || "your-username",
        name: process.env.GH_REPO || "your-repo-name",
      },
      draft: true,
      prerelease: false,
      generateReleaseNotes: true,
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/features/shell/main.ts",
          config: "vite.main.config.mts",
          target: "main",
        },
        {
          entry: "src/features/shell/preload.ts",
          config: "vite.preload.config.mts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.mts",
        },
      ],
    }),

    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
