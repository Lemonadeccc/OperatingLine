import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === '@operatingline/openai-planner-provider' ||
      specifier.startsWith('@operatingline/openai-planner-provider/') ||
      specifier === '@operatingline/cli-planner-provider' ||
      specifier.startsWith('@operatingline/cli-planner-provider/') ||
      specifier === 'openai' ||
      specifier.startsWith('openai/')
    ) {
      throw new Error(`Default runtime imported forbidden optional provider module: ${specifier}`);
    }
    return nextResolve(specifier, context);
  },
});
