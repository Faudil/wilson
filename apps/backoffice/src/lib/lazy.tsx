import { Component, lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { ErrorBox, Skeleton } from "../components/ui";

type Screens<M, K extends keyof M> = { [P in K]: LazyExoticComponent<M[P] & ComponentType<any>> };

/** A dropped connection is common on mobile data: try the download a second time before giving up. */
async function importWithRetry<M>(load: () => Promise<M>): Promise<M> {
  try {
    return await load();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return load();
  }
}

const loaders: (() => Promise<unknown>)[] = [];

/**
 * Once the current screen is shown, download the other screens in the background, one after the other, so opening
 * them later is instant. Skipped when the phone asks to save data (Android "Data Saver").
 */
export function prefetchScreens(): void {
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  const idle = (fn: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(fn, 2000));
  idle(async () => {
    for (const load of loaders) await load().catch(() => undefined); // a failure here is retried when the screen opens
  });
}

/**
 * React.lazy for named exports: each screen module becomes its own chunk, downloaded the first time it is opened.
 *   const { Queue } = lazyScreens(() => import("../screens/Queue"), "Queue");
 * Render inside <LazyBoundary> (the Shell does it).
 */
export function lazyScreens<M, K extends keyof M>(load: () => Promise<M>, ...names: K[]): Screens<M, K> {
  loaders.push(load);
  const out = {} as Screens<M, K>;
  for (const name of names) {
    out[name] = lazy(async () => ({ default: (await importWithRetry(load))[name] as ComponentType<any> })) as Screens<M, K>[K];
  }
  return out;
}

/** Skeleton while a screen downloads; if the download still fails, an error with a reload button instead of a blank page. */
export class LazyBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  // Opening another screen (hash router) clears the error.
  private readonly reset = () => this.setState({ error: null });
  override componentDidMount() {
    window.addEventListener("hashchange", this.reset);
  }
  override componentWillUnmount() {
    window.removeEventListener("hashchange", this.reset);
  }
  override render() {
    if (this.state.error) return <ErrorBox error={this.state.error} retry={() => location.reload()} />;
    return <Suspense fallback={<Skeleton lines={3} />}>{this.props.children}</Suspense>;
  }
}
