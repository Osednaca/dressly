import { CATEGORY_LABELS } from "@/lib/catalog/products";
import type { Product } from "@/lib/types";

/** A single product line in the final look. Image, house, name, price. */
export function ProductCard({ product }: { product: Product }) {
  return (
    <article className="group flex items-center gap-4 border-t border-chrome/10 py-3 first:border-t-0">
      <div className="h-16 w-14 shrink-0 overflow-hidden rounded-[3px] border border-chrome/12 bg-night transition duration-300 group-hover:border-accent/50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.image}
          alt={product.name}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="overline text-muted">{CATEGORY_LABELS[product.category]}</p>
        <p className="truncate text-[14px] text-text-primary">{product.name}</p>
        <p className="text-[12px] text-muted">{product.brand}</p>
      </div>
      <p className="shrink-0 text-[14px] tabular-nums text-text-primary">${product.price}</p>
    </article>
  );
}
