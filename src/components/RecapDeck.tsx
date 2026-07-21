import { useState } from "react";
import { recapDeckSchema } from "../shared/schemas";
import type { RecapDeck as RecapDeckModel } from "../shared/types";

export function RecapDeck({ deck }: { deck: RecapDeckModel }) {
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, deck.slides.length - 1);
  const slide = deck.slides[safeIndex]!;
  const image = slide.beeldPad
    ? slide.beeldPad.startsWith("file://") || slide.beeldPad.startsWith("http")
      ? slide.beeldPad
      : `file://${slide.beeldPad}`
    : undefined;
  return (
    <section className={`recap-deck recap-${slide.soort}`} aria-label="Aiden recapdeck">
      <header>
        <span>{labelFor(slide.soort)}</span>
        <small>{safeIndex + 1} / {deck.slides.length}</small>
      </header>
      <article>
        <div className="recap-copy">
          <h2>{slide.titel}</h2>
          <ul>{slide.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
        </div>
        {image ? <img src={image} alt="" /> : slide.beeldPrompt ? <div className="recap-image-pending">Beeld volgt…</div> : null}
      </article>
      <nav aria-label="Recapslides">
        <button disabled={safeIndex === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>Vorige</button>
        <div>{deck.slides.map((item, slideIndex) => (
          <button
            key={item.id}
            className={slideIndex === safeIndex ? "active" : ""}
            aria-label={`Ga naar slide ${slideIndex + 1}`}
            onClick={() => setIndex(slideIndex)}
          />
        ))}</div>
        <button disabled={safeIndex === deck.slides.length - 1} onClick={() => setIndex((value) => Math.min(deck.slides.length - 1, value + 1))}>Volgende</button>
      </nav>
    </section>
  );
}

export function parseRecapDeck(content: string): RecapDeckModel | undefined {
  try {
    const parsed = recapDeckSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function labelFor(kind: RecapDeckModel["slides"][number]["soort"]): string {
  if (kind === "deelnemer") return "Deelnemer";
  if (kind === "slot") return "Tot slot";
  return "Programmablok";
}
