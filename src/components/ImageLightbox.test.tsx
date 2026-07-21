import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Asset } from "../types";
import { constrainLightboxViewport, getLightboxStageViewport, getLightboxViewportSize, ImageLightbox } from "./ImageLightbox";

const storageMock = vi.hoisted(() => ({
  getAsset: vi.fn(),
}));

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

vi.mock("../services/storageAdapter", () => ({
  storage: storageMock,
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

const pointerEvent = (type: string, pointerId: number, clientX: number, clientY: number): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { configurable: true, value: pointerId },
    clientX: { configurable: true, value: clientX },
    clientY: { configurable: true, value: clientY },
  });
  return event;
};

afterEach(() => {
  document.documentElement.classList.remove("image-lightbox-open");
  document.body.classList.remove("image-lightbox-open");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  storageMock.getAsset.mockResolvedValue(imageAsset);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:test"),
    revokeObjectURL: vi.fn(),
  });
});

describe("ImageLightbox", () => {
  it("does not lock document scrolling while mounted", () => {
    const view = render(
      <ImageLightbox images={[{ id: imageAsset.id, kind: "image", title: "图片" }]} initialIndex={0} onClose={vi.fn()} />,
    );

    expect(screen.getByRole("dialog", { name: "图片" })).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass("image-lightbox-open");
    expect(document.body).not.toHaveClass("image-lightbox-open");

    view.unmount();

    expect(document.documentElement).not.toHaveClass("image-lightbox-open");
    expect(document.body).not.toHaveClass("image-lightbox-open");
  });

  it("restores the previous scroll position when closed", async () => {
    const onClose = vi.fn();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "scrollX", "get").mockReturnValue(12);
    vi.spyOn(window, "scrollY", "get").mockReturnValue(345);

    render(<ImageLightbox images={[{ id: imageAsset.id, kind: "image", title: "图片" }]} initialIndex={0} onClose={onClose} />);
    await waitFor(() => expect(storageMock.getAsset).toHaveBeenCalled());
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

    const view = render(<ImageLightbox images={[{ id: imageAsset.id, kind: "image", title: "图片" }]} initialIndex={0} onClose={vi.fn()} />);

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

  it("navigates a record image queue with disabled endpoints and an index counter", async () => {
    storageMock.getAsset.mockImplementation(async (id: string) => ({ ...imageAsset, id, title: `图片 ${id}` }));
    render(
      <ImageLightbox
        images={[
          { id: "asset-1", kind: "image", title: "第一张" },
          { id: "asset-2", kind: "image", title: "第二张" },
          { id: "asset-3", kind: "image", title: "第三张" },
        ]}
        initialIndex={1}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("图片序号")).toHaveTextContent("2 / 3"));
    expect(screen.getByRole("button", { name: "上一张" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "下一张" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "下一张" }));
    await waitFor(() => expect(screen.getByLabelText("图片序号")).toHaveTextContent("3 / 3"));
    expect(screen.getByRole("button", { name: "下一张" })).toBeDisabled();
    expect(storageMock.getAsset).toHaveBeenLastCalledWith("asset-3");
  });

  it("keeps navigation available when one queued image resource is missing", async () => {
    storageMock.getAsset.mockImplementation(async (id: string) => id === "missing" ? undefined : { ...imageAsset, id });
    render(
      <ImageLightbox
        images={[
          { id: "missing", kind: "image", title: "缺失图片" },
          { id: "asset-2", kind: "image", title: "第二张" },
        ]}
        initialIndex={0}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("图片资源不可用")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "下一张" }));
    await waitFor(() => expect(screen.getByLabelText("图片序号")).toHaveTextContent("2 / 2"));
    expect(await screen.findByRole("img", { name: "第二张" })).toBeInTheDocument();
  });

  it("changes images on an unzoomed horizontal swipe but preserves a zoom gesture", async () => {
    storageMock.getAsset.mockImplementation(async (id: string) => ({ ...imageAsset, id }));
    render(
      <ImageLightbox
        images={[
          { id: "asset-1", kind: "image", title: "第一张" },
          { id: "asset-2", kind: "image", title: "第二张" },
        ]}
        initialIndex={0}
        onClose={vi.fn()}
      />,
    );

    const stage = document.querySelector<HTMLDivElement>(".image-lightbox-stage")!;
    Object.defineProperty(stage, "setPointerCapture", { configurable: true, value: vi.fn() });
    const image = await screen.findByRole("img", { name: "第一张" });
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 800 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 600 });
    fireEvent.load(image);

    fireEvent(stage, pointerEvent("pointerdown", 1, 240, 180));
    fireEvent(stage, pointerEvent("pointerup", 1, 120, 182));
    await waitFor(() => expect(screen.getByLabelText("图片序号")).toHaveTextContent("2 / 2"));

    const secondImage = await screen.findByRole("img", { name: "第二张" });
    Object.defineProperty(secondImage, "naturalWidth", { configurable: true, value: 800 });
    Object.defineProperty(secondImage, "naturalHeight", { configurable: true, value: 600 });
    fireEvent.load(secondImage);
    fireEvent(stage, pointerEvent("pointerdown", 1, 180, 160));
    fireEvent(stage, pointerEvent("pointerdown", 2, 230, 160));
    fireEvent(stage, pointerEvent("pointermove", 2, 270, 160));
    fireEvent(stage, pointerEvent("pointerup", 2, 270, 160));
    fireEvent(stage, pointerEvent("pointerup", 1, 80, 160));

    expect(screen.getByLabelText("图片序号")).toHaveTextContent("2 / 2");
  });
});
