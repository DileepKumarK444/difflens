import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-medium">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">There’s nothing at this address.</p>
      <Link href="/" className="mt-4 inline-block text-sm underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
