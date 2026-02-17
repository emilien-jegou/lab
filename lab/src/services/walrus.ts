import { Config, Effect, Layer, Stream, Schedule, Queue } from "effect"
import { MessageBroker } from "~/core/system"

export const WalrusBrokerLive = Layer.effect(
  MessageBroker,
  Effect.gen(function*() {
    const walrusUrl = yield* Config.string("WALRUS_URL").pipe(Config.withDefault("tcp://localhost:9091"))
    const url = new URL(walrusUrl)
    const port = parseInt(url.port) || 9091
    const hostname = url.hostname

    const encodeCommand = (cmd: string) => {
      const cmdLen = Buffer.byteLength(cmd, "utf8")
      const buf = Buffer.alloc(4 + cmdLen)
      buf.writeUInt32LE(cmdLen, 0)
      buf.write(cmd, 4, "utf8")
      return buf
    }

    const publishQueue = yield* Queue.unbounded<{ topic: string; payload: unknown }>()

    const publisherDaemon = Effect.gen(function*() {
      let socket: import("bun").TCPSocket | null = null
      const registeredTopics = new Set<string>()

      const connect = () =>
        Effect.async<import("bun").TCPSocket, Error>((resume) => {
          Bun.connect({
            hostname, port,
            socket: {
              data() { },
              drain() { },
              close() { socket = null; registeredTopics.clear() },
              error(_, err) { socket = null; resume(Effect.fail(err as Error)) },
              open(sock) { resume(Effect.succeed(sock)) }
            }
          }).catch(err => resume(Effect.fail(err)))
        })

      while (true) {
        const item = yield* Queue.take(publishQueue)

        if (!socket) {
          socket = yield* connect().pipe(
            Effect.retry(Schedule.spaced("1 seconds")),
            Effect.tap(() => Effect.logDebug("[Walrus] Publisher Connected"))
          )
        }

        if (!registeredTopics.has(item.topic)) {
          socket.write(encodeCommand(`REGISTER ${item.topic}`))
          registeredTopics.add(item.topic)
        }

        const command = `PUT ${item.topic} ${JSON.stringify(item.payload)}`
        socket.write(encodeCommand(command))
      }
    })

    yield* Effect.forkDaemon(publisherDaemon)

    return {
      publish: (topic: string, payload: unknown) =>
        Queue.offer(publishQueue, { topic, payload }).pipe(Effect.asVoid),

      subscribe: (topic: string) => {
        const stream = Stream.async<unknown, Error>((emit) => {
          let socket: import("bun").TCPSocket | null = null
          let buffer = Buffer.alloc(0)
          let pollInterval: any = null

          const cleanup = () => {
            if (pollInterval) clearInterval(pollInterval)
            if (socket) { socket.end(); socket = null }
          }

          const setupConnection = async () => {
            try {
              socket = await Bun.connect({
                hostname, port,
                socket: {
                  open(sock) {
                    sock.write(encodeCommand(`REGISTER ${topic}`))

                    pollInterval = setInterval(() => {
                      if (socket) socket.write(encodeCommand(`GET ${topic}`))
                    }, 100)
                  },
                  data(_socket, chunk) {
                    buffer = Buffer.concat([buffer, chunk])
                    while (buffer.length >= 4) {
                      const len = buffer.readUInt32LE(0)
                      if (buffer.length < 4 + len) break
                      const raw = buffer.subarray(4, 4 + len).toString("utf8")
                      buffer = buffer.subarray(4 + len)

                      if (raw.startsWith("OK ")) {
                        try {
                          emit.single(JSON.parse(raw.substring(3)))
                        } catch (e) {
                          console.error("[Walrus Sub] Parse Error", e)
                        }
                      } else if (raw === "EMPTY") {
                      } else if (raw.startsWith("ERR")) {
                        console.warn(`[Walrus Sub] Topic Error: ${raw}`)
                      }
                    }
                  },
                  error(sock, _err) { sock.end() },
                  close() {
                    if (pollInterval) clearInterval(pollInterval)
                    socket = null
                    setTimeout(setupConnection, 1000)
                  }
                }
              })
            } catch (err) {
              setTimeout(setupConnection, 1000)
            }
          }

          setupConnection()
          return Effect.sync(() => cleanup())
        })

        return stream.pipe(
          Stream.retry(Schedule.spaced("2 seconds")),
          Stream.orDie
        )
      }
    }
  })
)
