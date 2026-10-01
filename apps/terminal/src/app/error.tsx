"use client";

import { Button, ErrorState } from "@sct/ui";

export default function RouteError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="This view failed to render."
      requestId={props.error.digest}
      action={<Button onClick={props.reset}>Try again</Button>}
    />
  );
}
