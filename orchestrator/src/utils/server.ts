import type { FastifyReply, FastifyRequest } from 'fastify';
import fastify from 'fastify';

const server = fastify();

export async function serve(port = 8108, host = '0.0.0.0') {
  await server.listen({ port, host });
  console.log(`Server listening on ${host}:${port}`);
}

export function addRoute(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS',
  path: string,
  handler: (req: FastifyRequest, res: FastifyReply) => Promise<void>,
) {
  const l: keyof typeof server = method.toLowerCase() as any;
  (server[l] as any)(path, async (req: FastifyRequest, res: FastifyReply) => {

    await handler(req, res);
  });
}
