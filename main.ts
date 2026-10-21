import { Map, NavigationControl, Marker, Popup } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import * as turf from '@turf/turf'

//地図データの読み込み
const map = new Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      gsi: {
        type: 'raster',
        //今回使う地図は「地理院タイル」から取得してる
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 18,
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
      },
    },
    layers: [{ id: 'gsi-base', type: 'raster', source: 'gsi' }],
  },
  center: [133.935, 34.675], 
  zoom: 13,
  maxZoom: 18,
})

//右上にズーム、方位のコントロール追加
map.addControl(new NavigationControl(), 'top-right')

let allParks: any[] = []
let clickedPoint: [number, number] | null = null
let clickMarker: Marker | null = null
let isSimulationMode = false

function calculateDistanceMeters(coord1: [number, number], coord2: [number, number]): number {
  const [lng1, lat1] = coord1
  const [lng2, lat2] = coord2
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(R * c)
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`
  return `${meters} m`
}

map.on('load', async () => {
  try {

    //公園ファイル(Geojson)読み込み部分
    const response = await fetch('/public_parks.geojson')
    if (!response.ok) throw new Error('GeoJSONの読み込みに失敗しました')
    const geojson = await response.json()
    allParks = geojson.features || []

    updateParkList()

    map.addSource('simulation-buffers-data', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'simulation-buffers-layer',
      type: 'fill',
      source: 'simulation-buffers-data',
      paint: {
        'fill-color': '#3498db',
        'fill-opacity': 0.25,
        'fill-outline-color': '#2980b9',
      },
    })

    map.addSource('simulation-points-data', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'simulation-points-layer',
      type: 'circle',
      source: 'simulation-points-data',
      paint: {
        'circle-radius': 4,
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.8,
      },
    })

    map.addSource('public-parks-data', {
      type: 'geojson',
      data: geojson,
    })
    map.addLayer({
      id: 'public-parks-layer',
      type: 'circle',
      source: 'public-parks-data',
      paint: {
        'circle-radius': 6,
        'circle-color': '#42b883',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    })

    setupEvents()
  } catch (err: any) {
    console.error(`読み込みエラー: ${err.message}`)
  }
})

function setupEvents() {
  //既存の公園をクリックした時のポップアップ
  map.on('click', 'public-parks-layer', (e) => {
    if (!e.features || e.features.length === 0) return
    const feature = e.features[0]
    const coords = (feature.geometry as any).coordinates as [number, number]
    const props = feature.properties

    new Popup({ closeButton: false, closeOnClick: true, offset: 10 })
      .setLngLat(coords)
      .setHTML(`<div style="padding: 2px; font-weight: bold; font-size: 13px; color: #2c3e50;">${props.name}</div>`)
      .addTo(map)
  })

  //マウスが乗った時のカーソル変更
  map.on('mouseenter', 'public-parks-layer', () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', 'public-parks-layer', () => { map.getCanvas().style.cursor = '' })

  //地図をクリックした時の処理
  map.on('click', (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['public-parks-layer'] })
    if (features.length > 0) return

    let lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat]
    
    // 🌟【テスト用】ここから追加！
    // どこをクリックしても、強制的にこの座標にピンを置く裏ワザ！
    // 使う方の「//」を消してね！
    //lngLat = [133.935, 34.675] // A地点の座標（さっき教えてくれたやつ！）
    //lngLat = [133.940, 34.680] // B地点の座標（Bの場所に合わせて変えて！）
    // 🌟ここまで追加！

    //クリック地点に赤いピンを立てる
    clickedPoint = lngLat
    if (!clickMarker) {
      clickMarker = new Marker({ color: '#e74c3c' }).setLngLat(lngLat).addTo(map)
    } else {
      clickMarker.setLngLat(lngLat)
    }

    document.getElementById('click-info')!.style.display = 'block'
    
    // シミュレーション計算（OFFの時は自動でストップするようになってる）
    runSimulation() 
    
    // サイドバーの公園リストを距離順に並び替え
    updateParkList()
  })

  //ピン削除ボタンの処理
  document.getElementById('reset-click-btn')?.addEventListener('click', () => {
    clickedPoint = null
    if (clickMarker) {
      clickMarker.remove()
      clickMarker = null
    }
    document.getElementById('click-info')!.style.display = 'none'
    runSimulation()
    updateParkList()
  })

  //シミュレーションON/OFFボタン押下の処理
  document.getElementById('toggle-sim-btn')?.addEventListener('click', (e) => {
    isSimulationMode = !isSimulationMode
    const btn = e.target as HTMLButtonElement
    const resultsDiv = document.getElementById('sim-results')

    if (isSimulationMode) {
      btn.textContent = 'シミュレーションをOFFにする'
      btn.style.background = '#e74c3c'
      if (resultsDiv) resultsDiv.style.display = 'block'
      runSimulation()
    } else {
      btn.textContent = 'シミュレーションをONにする'
      btn.style.background = '#34495e'
      if (resultsDiv) resultsDiv.style.display = 'none'
      
      ;(map.getSource('simulation-points-data') as any)?.setData({ type: 'FeatureCollection', features: [] })
      ;(map.getSource('simulation-buffers-data') as any)?.setData({ type: 'FeatureCollection', features: [] })
    }
  })

  //プルダウンを変えた時の処理(距離圏の変更)
  document.getElementById('sim-radius')?.addEventListener('change', () => {
    if (isSimulationMode) runSimulation()
  })
}

function updateParkList() {
  let displayParks = [...allParks]
  if (clickedPoint) {
    displayParks = displayParks.map((park) => {
      const coords = (park.geometry as any).coordinates as [number, number]
      const dist = calculateDistanceMeters(clickedPoint!, coords)
      return { ...park, _distance: dist }
    })
    displayParks.sort((a, b) => a._distance - b._distance)
  }
  renderList(displayParks)
}

//ビフォーアフターの差分を計算するように変更
async function runSimulation() {
  if (!isSimulationMode) return

  try {
    const radiusStr = (document.getElementById('sim-radius') as HTMLSelectElement).value
    const currentRadius = parseInt(radiusStr, 10)

    //四角敷き詰めデータ
    const response = await fetch('/shikaku.geojson')
    const boundaryData = await response.json()
    const boundaryPolygon = boundaryData.features[0]

    const bbox = turf.bbox(boundaryPolygon)
    //0.1km(100m)間隔で点を生成できる
    const grid = turf.pointGrid(bbox, 0.2, { units: 'kilometers' })

    const samplePoints: any[] = []
    
    // 計算用の変数を用意
    let baseCoveredCount = 0 // 元々の公園だけでカバーできている数
    let totalCoveredCount = 0 // 仮想公園も含めてカバーできた数
    let newlyCoveredCount = 0 // 仮想公園のおかげで「新しく」カバーできた数

    turf.featureEach(grid, function (currentPoint) {
      if (turf.booleanPointInPolygon(currentPoint, boundaryPolygon)) {
        let isBaseCovered = false
        let isVirtualCovered = false
        const ptCoords = currentPoint.geometry.coordinates as [number, number]

        //公園との距離チェック
        for (const park of allParks) {
          const parkCoords = (park.geometry as any).coordinates as [number, number]
          if (calculateDistanceMeters(ptCoords, parkCoords) <= currentRadius) {
            isBaseCovered = true
            break
          }
        }

        //クリック地点との距離チェック
        if (clickedPoint) {
          if (calculateDistanceMeters(ptCoords, clickedPoint) <= currentRadius) {
            isVirtualCovered = true
          }
        }

        //判定
        const isCovered = isBaseCovered || isVirtualCovered
        currentPoint.properties = { color: isCovered ? '#42b883' : '#e74c3c' }
        samplePoints.push(currentPoint)

        // 集計
        if (isBaseCovered) baseCoveredCount++
        if (isCovered) totalCoveredCount++
        if (!isBaseCovered && isVirtualCovered) newlyCoveredCount++ // これが差分！
      }
    })

    const bufferFeatures: any[] = []
    for (const park of allParks) {
      const buffered = turf.buffer(park, currentRadius / 1000, { units: 'kilometers' })
      if (buffered) bufferFeatures.push(buffered)
    }
    if (clickedPoint) {
      const clickPtFeature = turf.point(clickedPoint)
      const clickBuffered = turf.buffer(clickPtFeature, currentRadius / 1000, { units: 'kilometers' })
      if (clickBuffered) bufferFeatures.push(clickBuffered)
    }

    ;(map.getSource('simulation-points-data') as any)?.setData(turf.featureCollection(samplePoints))
    ;(map.getSource('simulation-buffers-data') as any)?.setData(turf.featureCollection(bufferFeatures))

    // 画面の数字を更新
    const total = samplePoints.length
    const uncoveredCount = total - totalCoveredCount
    
    const basePercentage = total > 0 ? (baseCoveredCount / total) * 100 : 0
    const totalPercentage = total > 0 ? (totalCoveredCount / total) * 100 : 0
    const diffPercentage = totalPercentage - basePercentage

    document.getElementById('sim-uncovered')!.textContent = String(uncoveredCount)
    document.getElementById('sim-covered')!.textContent = String(totalCoveredCount)
    document.getElementById('sim-percentage')!.textContent = totalPercentage.toFixed(1)

    // ▼ 差分の表示（ピンが置かれている時だけ +〇〇 と表示する）
    const diffPointsEl = document.getElementById('sim-covered-diff')!
    const diffPercentEl = document.getElementById('sim-percent-diff')!

    if (clickedPoint && newlyCoveredCount > 0) {
      diffPointsEl.textContent = `(+${newlyCoveredCount}点)`
      diffPercentEl.textContent = `(+${diffPercentage.toFixed(1)}%)`
    } else {
      diffPointsEl.textContent = ''
      diffPercentEl.textContent = ''
    }

  } catch (error) {
    console.error("シミュレーションエラー:", error)
  }
}

function renderList(parks: any[]) {
  const listEl = document.getElementById('park-list')
  if (!listEl) return
  listEl.innerHTML = ''

  parks.forEach((feature) => {
    const props = feature.properties
    const coords = (feature.geometry as any).coordinates

    const li = document.createElement('li')
    li.className = 'park-item'
    li.style.padding = '10px'
    li.style.borderBottom = '1px solid #eee'
    li.style.cursor = 'pointer'
    li.style.transition = 'background-color 0.2s'

    li.addEventListener('mouseover', () => { li.style.backgroundColor = '#f8f9fa' })
    li.addEventListener('mouseout', () => { li.style.backgroundColor = 'transparent' })

    const topRow = document.createElement('div')
    topRow.style.display = 'flex'
    topRow.style.justifyContent = 'space-between'
    topRow.style.alignItems = 'center'

    const nameSpan = document.createElement('span')
    nameSpan.style.fontWeight = 'bold'
    nameSpan.style.fontSize = '13px'
    nameSpan.style.color = '#2c3e50'
    nameSpan.textContent = props.name
    topRow.appendChild(nameSpan)

    if (feature._distance !== undefined) {
      const distSpan = document.createElement('span')
      distSpan.style.fontWeight = 'bold'
      distSpan.style.fontSize = '12px'
      distSpan.style.color = '#e74c3c'
      distSpan.textContent = formatDistance(feature._distance)
      topRow.appendChild(distSpan)
    }

    const metaDiv = document.createElement('div')
    metaDiv.style.fontSize = '11px'
    metaDiv.style.color = '#7f8c8d'
    metaDiv.style.marginTop = '4px'
    metaDiv.textContent = `エリア: ${props.ward || 'その他'}`

    li.appendChild(topRow)
    li.appendChild(metaDiv)

    li.addEventListener('click', () => {
      map.flyTo({ center: coords, zoom: 16, speed: 1.2 })
    })

    listEl.appendChild(li)
  })
}