import globals from "globals"

import { config } from "@workspace/eslint-config/base"

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
]
