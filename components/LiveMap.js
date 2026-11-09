'use client';
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export default function LiveMap({ points, trail = [] }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const fitted = useRef(false);
  const trailLayer = useRef(null);

  useEffect(() => {
    map.current = L.map(el.current).setView([20.59, 78.96], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    trailLayer.current = L.layerGroup().addTo(map.current);
    return () => map.current.remove();
  }, []);

  useEffect(() => {
    layer.current.clearLayers();
    points.forEach((p) => {
      const ll = [p.lat, p.lng];
      const approx = p.source === 'ip';
      L.circle(ll, {
        radius: approx ? 15000 : Math.max(p.accuracy || 20, 10),
        color: approx ? '#b45309' : '#0f766e', weight: 1, fillOpacity: 0.12,
      }).addTo(layer.current);
      L.circleMarker(ll, {
        radius: 9, color: '#fff', weight: 2, fillOpacity: 1,
        fillColor: p.me ? '#1d4ed8' : '#0f766e',
      }).bindTooltip(p.name + (approx ? ' (approx.)' : ''), { permanent: true, direction: 'top', offset: [0, -8] })
        .addTo(layer.current);
    });
    if (points.length && !fitted.current) {
      map.current.fitBounds(points.map((p) => [p.lat, p.lng]), { padding: [60, 60], maxZoom: 15 });
      fitted.current = true;
    }
  }, [points]);

  useEffect(() => {
    trailLayer.current.clearLayers();
    if (trail.length < 2) return;
    const ll = trail.map((t) => [t.lat, t.lng]);
    L.polyline(ll, { color: '#1d4ed8', weight: 3, opacity: 0.7, dashArray: '6 6' }).addTo(trailLayer.current);
    ll.forEach((p, i) => L.circleMarker(p, { radius: 3, color: '#1d4ed8', fillOpacity: 1 })
      .bindTooltip(new Date(trail[i].recorded_at).toLocaleString()).addTo(trailLayer.current));
    map.current.fitBounds(ll, { padding: [60, 60], maxZoom: 16 });
  }, [trail]);

  return <div ref={el} style={{ height: '100%', width: '100%' }} />;
}
