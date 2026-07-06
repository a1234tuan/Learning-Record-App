import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Asset } from "../types";
import { constrainLightboxViewport, getLightboxStageViewport, getLightboxViewportSize, ImageLightbox } from "./ImageLightbox";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => false,
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(),
  },
}));

const imageAsset: Asset = {
  id: "asset-1",
  createdAt: "2026-06-21T00:00:00.000Z",
  updatedAt: "2026-06-21T00:00:00.000Z",
  kind: "image",
  fileName: "photo.png",
  mimeType: "image/png",
  size: 100,
  data: new Blob(["image"], { type: "image/png" }),
};

afterEach(() => {
  document.documentElement.classList.remove("image-lightbox-open");
  document.body.classList.remove("image-lightbox-open");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ImageLightbox", () => {
  it("does not lock document scrolling while mounted", () => {
    const view = render(
      <ImageLightbox asset={imageAsset} url="blob:test" title="图片" onClose={vi.fn()} />,
    );

    expect(screen.getByRole("dialog", { name: "图片" })).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass("image-lightbox-open");
    expect(document.body).not.toHaveClass("image-lightbox-open");

    view.unmount();

    expect(document.documentElement).not.toHaveClass("image-lightbox-open");
    expect(document.body).not.toHaveClass("image-lightbox-open");
  });

  it("restores the previous scroll position when closed", () => {
    const onClose = vi.fn();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "scrollX", "get").mockReturnValue(12);
    vi.spyOn(window, "scrollY", "get").mockReturnValue(345);

    render(<ImageLightbox asset={imageAsset} url="blob:test" title="图片" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(12, 345);
  });

  it("does not listen to visualViewport scroll events", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal("visualViewport", {
      width: 390,
      height: 740,
      addEventListener,
      removeEventListener,
    });

    const view = render(<ImageLightbox asset={imageAsset} url="blob:test" title="图片" onClose={vi.fn()} />);

    expect(addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(addEventListener).not.toHaveBeenCalledWith("scroll", expect.any(Function));

    view.unmount();

    expect(removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(removeEventListener).not.toHaveBeenCalledWith("scroll", expect.any(Function));
  });

  it("constrains measured stage size to the visual viewport", () => {
    expect(constrainLightboxViewport({ width: 1600, height: 1200 }, { width: 390, height: 740 })).toEqual({
      width: 390,
      height: 740,
    });
  });

  it("uses the real viewport size even when the page is wider than the screen", () => {
    expect(getLightboxViewportSize({ width: 390, height: 740 })).toEqual({
      width: 390,
      height: 740,
    });
  });

  it("sizes the image stage to the visible viewport below the toolbar", () => {
    expect(getLightboxStageViewport({ width: 390, height: 740 }, 64)).toEqual({
      width: 390,
      height: 676,
    });
  });
});
