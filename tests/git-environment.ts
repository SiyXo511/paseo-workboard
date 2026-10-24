import { devNull } from "node:os";

export function isolatedGitEnvironment(template: string): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)),
    ),
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TEMPLATE_DIR: template,
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: template,
    GIT_CONFIG_KEY_1: "core.excludesFile",
    GIT_CONFIG_VALUE_1: devNull,
    GIT_CONFIG_KEY_2: "core.attributesFile",
    GIT_CONFIG_VALUE_2: devNull,
  };
}
