import { useEffect, useMemo, useState, type MutableRefObject } from 'react'
import type { Vector3 } from 'three'
import type { TownSnapshot } from '../data/models'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'
import { getHouseTitle } from '../scene/objects/houses/houseLayout'
import { PLAZA_RADIUS } from '../scene/objects/fountain/fountainLayout'
import { getTownRoads } from '../scene/objects/roads/roadLayout'
import { groupTownObjects } from '../scene/townObjectGroups'
import { CloseButton } from './CloseButton'

export interface TownMapPanelProps {
  language: AppLanguage
  town: TownSnapshot
  playerPosition: MutableRefObject<Vector3>
  onClose: () => void
}

export function TownMapPanel({ language, town, playerPosition, onClose }: TownMapPanelProps) {
  const copy = languageCopy[language].hud
  const petHouse = languageCopy[language].pet.house(town.pet.name[language])
  const [visitorPosition, setVisitorPosition] = useState(() => ({
    x: playerPosition.current.x,
    z: playerPosition.current.z,
  }))
  const [selectedHomeId, setSelectedHomeId] = useState<string | null>(null)
  const objects = useMemo(() => {
    const groups = groupTownObjects(town.objects)
    return { ...groups, roads: getTownRoads(groups.roads) }
  }, [town.objects])
  const { fountain, guestbook } = objects

  useEffect(() => {
    const updatePosition = () => setVisitorPosition({ x: playerPosition.current.x, z: playerPosition.current.z })
    const timer = window.setInterval(updatePosition, 250)
    return () => window.clearInterval(timer)
  }, [playerPosition])

  return (
    <aside className="drawer map-panel" role="dialog" aria-labelledby="map-title">
      <header className="drawer-header">
        <div>
          <p className="eyebrow">{copy.mapEyebrow}</p>
          <h2 id="map-title">{copy.mapTitle}</h2>
        </div>
        <CloseButton autoFocus onClick={onClose} label={copy.closeMap} />
      </header>
      <svg className="town-map" viewBox="-53 -53 106 106" role="img" aria-label={copy.mapDescription}>
        <rect className="map-ground" x="-53" y="-53" width="106" height="106" rx="5" />
        {objects.roads.map((road) => (
          <polyline
            key={road.id}
            className="map-road"
            points={road.points.map(([x, z]) => `${x},${z}`).join(' ')}
            style={{ stroke: road.color }}
            strokeWidth={road.width}
          />
        ))}
        {fountain && (
          <g transform={`translate(${fountain.position.x} ${fountain.position.z}) scale(${fountain.scale})`}>
            <circle className="map-plaza" r={PLAZA_RADIUS - 0.7} />
            <g className="map-fountain">
              <circle r="3.8">
                <title>{copy.mapFountain}</title>
              </circle>
              <circle r="2.35" />
              <circle r="0.7" />
            </g>
          </g>
        )}
        {guestbook && (
          <g
            className="map-guestbook"
            transform={`translate(${guestbook.position.x} ${guestbook.position.z}) rotate(${(-guestbook.rotation * 180) / Math.PI})`}
          >
            <rect x="-2.2" y="-0.7" width="4.4" height="1.4" rx="0.3">
              <title>{copy.mapGuestbook}</title>
            </rect>
            <circle cx="-0.85" cy="-0.08" r="0.18" />
            <circle cx="0" cy="0.12" r="0.18" />
            <circle cx="0.85" cy="-0.12" r="0.18" />
          </g>
        )}
        {objects.benches.map((bench) => (
          <rect
            key={bench.id}
            className="map-bench"
            x={bench.position.x - 1.5}
            y={bench.position.z - 0.55}
            width="3"
            height="1.1"
            rx="0.35"
          >
            <title>{copy.mapBench}</title>
          </rect>
        ))}
        {objects.houses.map((house) => (
          <rect
            key={house.id}
            className={`map-house${selectedHomeId === house.id ? ' is-highlighted' : ''}`}
            x={house.position.x - 2.7}
            y={house.position.z - 2.25}
            width="5.4"
            height="4.5"
            rx="1.1"
            fill={house.color}
          >
            <title>{getHouseTitle(house)}</title>
          </rect>
        ))}
        {objects.dogHouses.map((house) => (
          <rect
            key={house.id}
            className={`map-dog-house${selectedHomeId === house.id ? ' is-highlighted' : ''}`}
            x={house.position.x - 1.2}
            y={house.position.z - 0.9}
            width="2.4"
            height="1.8"
            rx="0.7"
          >
            <title>{petHouse}</title>
          </rect>
        ))}
        <g className="map-player" transform={`translate(${visitorPosition.x} ${visitorPosition.z})`}>
          <circle r="2.2" />
          <circle r="0.8" />
          <title>{copy.mapYou}</title>
        </g>
      </svg>
      <div className="map-legend" aria-label={copy.mapLegend}>
        <span className="map-key map-key-player">{copy.mapYou}</span>
        <span className="map-key map-key-bench">{copy.mapBenches}</span>
        <span className="map-key map-key-fountain">{copy.mapFountain}</span>
        <span className="map-key map-key-guestbook">{copy.mapGuestbook}</span>
      </div>
      <ul className="map-home-list" aria-label={copy.mapHomes}>
        {objects.houses.map((house) => (
          <li key={house.id}>
            <button
              type="button"
              aria-pressed={selectedHomeId === house.id}
              onClick={() => setSelectedHomeId(house.id)}
            >
              <i aria-hidden="true" style={{ backgroundColor: house.color }} />
              {getHouseTitle(house)}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            aria-pressed={selectedHomeId === objects.dogHouses[0]?.id}
            onClick={() => setSelectedHomeId(objects.dogHouses[0]?.id ?? null)}
          >
            <i className="pet-home-key" aria-hidden="true" />
            {petHouse}
          </button>
        </li>
      </ul>
    </aside>
  )
}
