import type { FastifyRequest } from 'fastify';
import fastify from 'fastify';

const server = fastify();

export async function serve(port = 8108) {
  await server.listen({ port });
  console.log(`Server listening on port ${port}`);
}

export function addRoute(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS',
  path: string,
  handler: (req: FastifyRequest) => Promise<void>,
) {
  server[method.toLowerCase()](path, async (req: FastifyRequest) => {
    await handler(req);
  });
}
