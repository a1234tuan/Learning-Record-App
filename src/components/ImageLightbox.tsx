import { Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

import type { Asset } from "../types";
import { downloadAsset } from "../services/assetDownloadService";

interface ImageLightboxProps {
  asset: Asset;
  url: string;
  title: string;
  onClose: () => void;
  onStatus?: (message: string) => void;
}

const distance = (touches: React.TouchList): number => {
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
};

export const ImageLightbox = ({ asset, url, title, onClose, onStatus }: ImageLightboxProps) => {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef({ x: 0, y: 0, startX: 0, startY: 0, dragging: false });
  const pinchRef = useRef({ distance: 0, scale: 1 });

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return undefined;
    }
    let remove: (() => Promise<void>) | undefined;
    let cancelled = false;
    void CapacitorApp.addListener("backButton", () => {
      onClose();
    }).then((handle) => {
      remove = handle.remove;
      if (cancelled) {
        void handle.remove();
      }
    });
    return () => {
      cancelled = true;
      if (remove) {
        void remove();
      }
    };
  }, [onClose]);

  const clampScale = (value: number) => Math.min(5, Math.max(1, value));

  return (
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={title}>
      <div className="image-lightbox-toolbar">
        <strong>{title}</strong>
        <div>
          <button
            type="button"
            className="icon-button"
            title="下载"
            onClick={async () => {
              try {
                onStatus?.(await downloadAsset(asset));
              } catch (error) {
                onStatus?.(error instanceof Error ? error.message : "下载失败。");
              }
            }}
          >
            <Download size={18} />
          </button>
          <button type="button" className="icon-button" title="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>
      <div
        className="image-lightbox-stage"
        onPointerDown={(event) => {
          dragRef.current = {
            x: offset.x,
            y: offset.y,
            startX: event.clientX,
            startY: event.clientY,
            dragging: true,
          };
        }}
        onPointerMove={(event) => {
          if (!dragRef.current.dragging || scale <= 1) {
            return;
          }
          setOffset({
            x: dragRef.current.x + event.clientX - dragRef.current.startX,
            y: dragRef.current.y + event.clientY - dragRef.current.startY,
          });
        }}
        onPointerUp={() => {
          dragRef.current.dragging = false;
        }}
        onPointerCancel={() => {
          dragRef.current.dragging = false;
        }}
        onDoubleClick={() => {
          setScale((value) => {
            const next = value > 1 ? 1 : 2;
            if (next === 1) {
              setOffset({ x: 0, y: 0 });
            }
            return next;
          });
        }}
        onTouchStart={(event) => {
          if (event.touches.length === 2) {
            pinchRef.current = { distance: distance(event.touches), scale };
          }
        }}
        onTouchMove={(event) => {
          if (event.touches.length !== 2 || pinchRef.current.distance === 0) {
            return;
          }
          event.preventDefault();
          setScale(clampScale(pinchRef.current.scale * (distance(event.touches) / pinchRef.current.distance)));
        }}
      >
        <img
          src={url}
          alt={title}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          }}
          draggable={false}
        />
      </div>
    </div>
  );
};
