"use client";

import { ProductCard } from "@/components/ProductCard";
import { Bag, Check, Play, Refresh, Sparkle, X } from "@/components/icons";
import { lookItems, lookTotal } from "@/lib/catalog/query";
import type { BlockedView, JobView } from "@/lib/api-types";
import type { Look, StylingSession } from "@/lib/types";

interface FinalLookProps {
  session: StylingSession;
  runwayAvailable: boolean;
  animationJob: JobView | null;
  animationBlocked: BlockedView | null;
  cartAdded: boolean;
  onAnimate: () => void;
  onAddToCart: () => void;
  onNewLook: () => void;
  onClose: () => void;
}

/** Your Dressly Look: the finished outfit, its pieces, its total, and the cart. */
export function FinalLook({
  session,
  runwayAvailable,
  animationJob,
  animationBlocked,
  cartAdded,
  onAnimate,
  onAddToCart,
  onNewLook,
  onClose,
}: FinalLookProps) {
  const activeLook: Look | undefined =
    session.looks.find((look) => look.id === session.activeLookId) ?? session.looks.at(-1);
  const items = lookItems(session.currentLook);
  const total = lookTotal(session.currentLook);
  const { metrics } = session;

  return (
    <div className="animate-fade fixed inset-0 z-40 overflow-y-auto bg-paper/95 backdrop-blur-sm">
      <button
        type="button"
        onClick={onClose}
        aria-label="Back to the fitting room"
        className="fixed right-5 top-5 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-card text-ink-soft transition hover:border-accent hover:text-accent"
      >
        <X width={17} height={17} />
      </button>
      <div className="mx-auto grid max-w-[1400px] gap-10 px-6 py-10 md:grid-cols-[1.1fr_0.9fr] md:px-10 md:py-14 lg:gap-16">
        <section className="animate-rise">
          <p className="overline text-accent">Your Dressly look</p>
          <h1 className="mt-3 text-[clamp(2.2rem,4.5vw,3.4rem)] leading-tight">
            {session.occasion ? `Ready for ${session.occasion}.` : "Your finished outfit."}
          </h1>

          <div className="relative mt-6 aspect-[3/4] overflow-hidden rounded-[3px] border border-line bg-night">
            {activeLook?.videoPath ? (
              <video
                src={activeLook.videoPath}
                controls
                autoPlay
                loop
                muted
                playsInline
                className="h-full w-full object-contain"
              />
            ) : activeLook ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={activeLook.imagePath}
                alt="Your final look"
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-white/40">
                No look generated
              </div>
            )}
            {animationJob?.status === "pending" ? (
              <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-[2px] bg-black/55 px-4 py-3 text-white backdrop-blur">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent-soft" />
                <span className="text-[12px]">{animationJob.step}</span>
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {runwayAvailable && activeLook && !activeLook.videoPath ? (
              <button
                type="button"
                onClick={onAnimate}
                disabled={animationJob?.status === "pending"}
                className="inline-flex items-center gap-2 rounded-[2px] border border-line px-4 py-2.5 text-[12px] uppercase tracking-[0.16em] text-ink-soft transition hover:border-accent hover:text-accent disabled:opacity-50"
              >
                <Play width={15} height={15} /> Bring this look to life
              </button>
            ) : null}
            <button
              type="button"
              onClick={onNewLook}
              className="inline-flex items-center gap-2 rounded-[2px] border border-line px-4 py-2.5 text-[12px] uppercase tracking-[0.16em] text-ink-soft transition hover:border-accent hover:text-accent"
            >
              <Refresh width={15} height={15} /> Start a new look
            </button>
          </div>
          {animationBlocked ? (
            <p className="mt-3 text-[12px] text-accent">{animationBlocked.message}</p>
          ) : null}
        </section>

        <section className="animate-rise" style={{ animationDelay: "120ms" }}>
          <div className="rounded-[3px] border border-line bg-card p-6">
            <p className="overline text-muted">The look</p>
            <div className="mt-3">
              {items.length === 0 ? (
                <p className="text-sm text-muted">Nothing selected.</p>
              ) : (
                items.map((product) => <ProductCard key={product.id} product={product} />)
              )}
            </div>
            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
              <span className="overline text-muted">Total</span>
              <span style={{ fontFamily: "var(--font-display)" }} className="text-3xl tabular-nums">
                ${total}
              </span>
            </div>
            <button
              type="button"
              onClick={onAddToCart}
              disabled={cartAdded || items.length === 0}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-[2px] bg-ink px-6 py-3.5 text-[13px] font-semibold uppercase tracking-[0.18em] text-paper transition hover:bg-accent disabled:bg-sage"
            >
              {cartAdded ? (
                <>
                  <Check width={16} height={16} /> Added to cart
                </>
              ) : (
                <>
                  <Bag width={16} height={16} /> Add complete look to cart
                </>
              )}
            </button>
            <p className="mt-2 text-center text-[11px] text-muted">
              Simulated checkout — no payment is taken.
            </p>
          </div>

          <div className="mt-5 rounded-[3px] border border-line bg-card p-6">
            <p className="overline text-muted">How Dressly narrowed it down</p>
            <dl className="mt-4 grid grid-cols-3 gap-4 text-center">
              {[
                [metrics.compatibleProducts, "compatible pieces"],
                [metrics.looksGenerated, "virtual try-ons"],
                [metrics.agentIterations, "agent decisions"],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt style={{ fontFamily: "var(--font-display)" }} className="text-3xl">
                    {value}
                  </dt>
                  <dd className="overline mt-1 text-muted">{label}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 flex items-center justify-center gap-2 text-[12px] text-ink-soft">
              <Sparkle width={14} height={14} className="text-accent" />
              {metrics.productsTried} pieces tried · {metrics.productsLiked} liked ·{" "}
              {metrics.productsRejected} rejected
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
