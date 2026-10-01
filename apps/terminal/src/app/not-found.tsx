import Link from "next/link";

export default function NotFound() {
  return (
    <p className="text-[12px] text-text-secondary">
      This view does not exist.{" "}
      <Link href="/" className="underline">
        Go to the wallet overview
      </Link>
      .
    </p>
  );
}
