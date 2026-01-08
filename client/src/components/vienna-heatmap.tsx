import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import viennaDistricts from "@/data/vienna-districts-official.json";

interface ViennaHeatmapProps {
  bezirkStats: Array<{
    bezirk_code: string;
    bezirk_name: string;
    avg_price: number;
    avg_eur_per_m2: number;
    min_price: number;
    max_price: number;
    count: number;
  }>;
}

export default function ViennaHeatmap({ bezirkStats }: ViennaHeatmapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    // Initialize map
    const map = L.map(mapRef.current).setView([48.2082, 16.3738], 11);

    // Add tile layer
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    mapInstance.current = map;

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapInstance.current || bezirkStats.length === 0) return;

    // Remove existing layers
    mapInstance.current.eachLayer((layer) => {
      if (layer instanceof L.GeoJSON) {
        mapInstance.current?.removeLayer(layer);
      }
    });

    // Create a map of bezirk code to stats
    const statsMap = new Map(
      bezirkStats.map(stat => [stat.bezirk_code, stat])
    );

    // Calculate min/max for color scale
    const eurPerM2Values = bezirkStats.map(s => s.avg_eur_per_m2).filter(v => v > 0);
    const minEurPerM2 = Math.min(...eurPerM2Values);
    const maxEurPerM2 = Math.max(...eurPerM2Values);

    // Color function based on €/m²
    const getColor = (eurPerM2: number) => {
      if (eurPerM2 === 0) return "#cccccc"; // Gray for no data

      const normalized = (eurPerM2 - minEurPerM2) / (maxEurPerM2 - minEurPerM2);

      // Green (cheap) to Red (expensive)
      if (normalized < 0.2) return "#22c55e"; // Green
      if (normalized < 0.4) return "#84cc16"; // Lime
      if (normalized < 0.6) return "#eab308"; // Yellow
      if (normalized < 0.8) return "#f97316"; // Orange
      return "#ef4444"; // Red
    };

    // Add GeoJSON layer
    L.geoJSON(viennaDistricts as any, {
      style: (feature) => {
        const bezirkCode = String(feature?.properties?.DISTRICT_CODE);
        const stats = statsMap.get(bezirkCode);
        const eurPerM2 = stats?.avg_eur_per_m2 || 0;

        return {
          fillColor: getColor(eurPerM2),
          weight: 2,
          opacity: 1,
          color: 'white',
          fillOpacity: 0.7
        };
      },
      onEachFeature: (feature, layer) => {
        const bezirkCode = String(feature.properties?.DISTRICT_CODE);
        const bezirkName = feature.properties?.NAMEK;
        const stats = statsMap.get(bezirkCode);

        if (stats) {
          const popupContent = `
            <div style="min-width: 200px;">
              <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold;">
                ${bezirkCode} ${bezirkName}
              </h3>
              <div style="font-size: 14px; line-height: 1.6;">
                <div><strong>Ø Preis:</strong> €${stats.avg_price.toLocaleString()}</div>
                <div><strong>Ø €/m²:</strong> €${stats.avg_eur_per_m2.toLocaleString()}</div>
                <div><strong>Min:</strong> €${stats.min_price.toLocaleString()}</div>
                <div><strong>Max:</strong> €${stats.max_price.toLocaleString()}</div>
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd;">
                  <strong>${stats.count} Inserate</strong>
                </div>
              </div>
            </div>
          `;
          layer.bindPopup(popupContent);
        } else {
          layer.bindPopup(`
            <div>
              <h3 style="margin: 0 0 8px 0;">${bezirkCode} ${bezirkName}</h3>
              <p style="color: #999;">Keine Daten vorhanden</p>
            </div>
          `);
        }

        // Hover effect
        layer.on({
          mouseover: (e) => {
            const layer = e.target;
            layer.setStyle({
              weight: 3,
              fillOpacity: 0.9
            });
          },
          mouseout: (e) => {
            const layer = e.target;
            layer.setStyle({
              weight: 2,
              fillOpacity: 0.7
            });
          }
        });
      }
    }).addTo(mapInstance.current);

    // Add legend
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'info legend');
      div.style.backgroundColor = 'white';
      div.style.padding = '10px';
      div.style.borderRadius = '5px';
      div.style.boxShadow = '0 0 15px rgba(0,0,0,0.2)';

      div.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 8px;">€/m² Preis</div>
        <div style="display: flex; align-items: center; margin-bottom: 4px;">
          <div style="width: 20px; height: 20px; background: #22c55e; margin-right: 8px;"></div>
          <span>Günstig</span>
        </div>
        <div style="display: flex; align-items: center; margin-bottom: 4px;">
          <div style="width: 20px; height: 20px; background: #eab308; margin-right: 8px;"></div>
          <span>Mittel</span>
        </div>
        <div style="display: flex; align-items: center; margin-bottom: 4px;">
          <div style="width: 20px; height: 20px; background: #ef4444; margin-right: 8px;"></div>
          <span>Teuer</span>
        </div>
        <div style="display: flex; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd;">
          <div style="width: 20px; height: 20px; background: #cccccc; margin-right: 8px;"></div>
          <span>Keine Daten</span>
        </div>
      `;

      return div;
    };
    legend.addTo(mapInstance.current);

  }, [bezirkStats]);

  return (
    <div
      ref={mapRef}
      style={{ width: "100%", height: "600px", borderRadius: "8px" }}
    />
  );
}
