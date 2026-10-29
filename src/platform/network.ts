import * as net from "net";
/** A port is in use when something accepts a connection on it (IPv4 or IPv6 loopback). */
export async function isPortFree(port: number): Promise<boolean> {
  const listening = (host: string) => new Promise<boolean>(resolve => {
    const socket = net.connect({ port, host });
    const done = (value: boolean) => { socket.destroy(); resolve(value); };
    socket.setTimeout(400, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
  const [v4, v6] = await Promise.all([listening("127.0.0.1"), listening("::1")]);
  return !v4 && !v6;
}


export const toolNetwork = { isPortFree };
