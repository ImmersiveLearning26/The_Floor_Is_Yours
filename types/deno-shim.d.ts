// Local type-checking only: the few Deno globals the Lovable Cloud edge function entry uses.
declare namespace Deno {
  const env: { get(key: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
}
