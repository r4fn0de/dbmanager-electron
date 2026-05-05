import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";

const updateBaseUrl = process.env.UPDATE_BASE_URL?.trim().replace(/\/+$/, "");
const winRemoteReleases = updateBaseUrl
  ? `${updateBaseUrl}/win32/${process.arch}`
  : undefined;
const macUpdateManifestBaseUrl = updateBaseUrl
  ? `${updateBaseUrl}/darwin/${process.arch}`
  : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    icon: "./icons/app-icon",
    asar: {
      unpack: "**/node_modules/{better-sqlite3,bindings,file-uri-to-path,embedded-postgres,@embedded-postgres,async-exit-hook,pg,pg-connection-string,pg-pool,pg-protocol,pg-types,pgpass,split2,pg-int8,postgres-array,postgres-bytea,postgres-date,postgres-interval,xtend}/**/*",
    },
    extraResource: [
      "node_modules/better-sqlite3",
      "node_modules/bindings",
      "node_modules/file-uri-to-path",
      "node_modules/embedded-postgres",
      "node_modules/@embedded-postgres",
      "node_modules/async-exit-hook",
      "node_modules/pg",
      "node_modules/pg-connection-string",
      "node_modules/pg-pool",
      "node_modules/pg-protocol",
      "node_modules/pg-types",
      "node_modules/pgpass",
      "node_modules/split2",
      "node_modules/pg-int8",
      "node_modules/postgres-array",
      "node_modules/postgres-bytea",
      "node_modules/postgres-date",
      "node_modules/postgres-interval",
      "node_modules/xtend",
    ],
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
  publishers: [],
  plugins: [
    new AutoUnpackNativesPlugin({}),
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
