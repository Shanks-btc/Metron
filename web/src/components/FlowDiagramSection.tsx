import DiagramFlow from "./DiagramFlow";

export default function FlowDiagramSection() {
  return (
    <section className="relative w-full overflow-hidden border-t border-subtle px-4 py-12 sm:px-6 sm:py-14 lg:px-8 lg:py-16">
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center text-center">
        <h2 className="w-full text-balance break-words font-display text-2xl font-bold text-ink-heading sm:text-3xl">
          One settled request, end to end.
        </h2>
        <p className="mt-3 w-full max-w-xl text-balance break-words text-sm leading-relaxed text-ink-body sm:text-base">
          Every quote flows through the same four stages before data is delivered.
        </p>
        <div className="mt-12 flex w-full items-center justify-center">
          <DiagramFlow />
        </div>
      </div>
    </section>
  );
}
