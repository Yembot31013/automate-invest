import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  Coordinate,
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from "lightweight-charts";

export type LwcZonePoint = { time: UTCTimestamp; price: number };

export type LwcZoneSpec = {
  p1: LwcZonePoint;
  p2: LwcZonePoint;
  fillColor: string;
  /** Extend rectangle to the right edge of the pane (long-position tool style). */
  extendRight?: boolean;
};

type ViewZone = {
  x1: Coordinate | null;
  x2: Coordinate | null;
  y1: Coordinate | null;
  y2: Coordinate | null;
  fill: string;
  extendRight: boolean;
};

function positionsBox(c1: number, c2: number, pixelRatio: number) {
  const s1 = Math.round(c1 * pixelRatio);
  const s2 = Math.round(c2 * pixelRatio);
  return { position: Math.min(s1, s2), length: Math.abs(s2 - s1) };
}

class ZonesPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private zones: ViewZone[]) {}

  draw(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const paneWidth = scope.bitmapSize.width / scope.horizontalPixelRatio;

      for (const z of this.zones) {
        if (z.y1 === null || z.y2 === null) continue;
        const x1 = z.x1 ?? 0;
        const x2 = z.extendRight ? paneWidth : z.x2;
        if (x2 === null) continue;

        const h = positionsBox(x1, x2, scope.horizontalPixelRatio);
        const v = positionsBox(z.y1, z.y2, scope.verticalPixelRatio);
        ctx.fillStyle = z.fill;
        ctx.fillRect(h.position, v.position, h.length, v.length);
      }
    });
  }
}

class ZonesPaneView implements IPrimitivePaneView {
  private zones: ViewZone[] = [];

  constructor(private source: StructureSetupOverlay) {}

  update() {
    const series = this.source.series;
    const timeScale = this.source.chart.timeScale();
    this.zones = this.source.zoneSpecs.map((spec) => ({
      x1: timeScale.timeToCoordinate(spec.p1.time),
      x2: timeScale.timeToCoordinate(spec.p2.time),
      y1: series.priceToCoordinate(spec.p1.price),
      y2: series.priceToCoordinate(spec.p2.price),
      fill: spec.fillColor,
      extendRight: spec.extendRight ?? false,
    }));
  }

  renderer() {
    return new ZonesPaneRenderer(this.zones);
  }

  zOrder() {
    return "bottom" as const;
  }
}

/** Draws OB / FVG / optional long-position boxes. Optionally expands Y-axis in full-trade mode. */
export class StructureSetupOverlay implements ISeriesPrimitive<Time> {
  chart!: IChartApiBase<Time>;
  series!: ISeriesApi<"Candlestick", Time>;
  private paneView: ZonesPaneView;

  constructor(
    public zoneSpecs: LwcZoneSpec[],
    public autoscaleRange: { min: number; max: number } | null = null,
  ) {
    this.paneView = new ZonesPaneView(this);
  }

  attached(param: SeriesAttachedParameter<Time, "Candlestick">) {
    this.chart = param.chart;
    this.series = param.series;
  }

  detached() {}

  paneViews() {
    return [this.paneView];
  }

  updateAllViews() {
    this.paneView.update();
  }

  autoscaleInfo() {
    if (!this.autoscaleRange) return null;
    return {
      priceRange: {
        minValue: this.autoscaleRange.min,
        maxValue: this.autoscaleRange.max,
      },
    };
  }
}
