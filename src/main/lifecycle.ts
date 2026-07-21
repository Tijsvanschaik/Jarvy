export type ShutdownStep = { name: string; run: () => void | Promise<void> };

export class ShutdownCoordinator {
  private shutdownPromise: Promise<void> | undefined;

  constructor(private readonly steps: ShutdownStep[]) {}

  shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.execute();
    }
    return this.shutdownPromise;
  }

  private async execute(): Promise<void> {
    const errors: string[] = [];
    for (const step of this.steps) {
      try {
        await step.run();
      } catch (error) {
        errors.push(`${step.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (errors.length) throw new AggregateError(errors, `Aiden shutdown completed with ${errors.length} controlled error(s).`);
  }
}
