import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import EMGSerial  from './EMGSerial'
import './EMGSerial.css'
function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div><EMGSerial/></div>
    </>
  )
}

export default App
