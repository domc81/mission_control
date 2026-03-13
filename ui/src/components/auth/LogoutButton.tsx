import { useAuth } from '../../context/AuthContext'

export function LogoutButton() {
  const { signOut } = useAuth()

  return (
    <button onClick={signOut} style={{ backgroundColor: '#dc2626', color: 'white', border: 'none', padding: '0.5rem', borderRadius: '0.25rem', cursor: 'pointer' }}>
      Sign out
    </button>
  )
}