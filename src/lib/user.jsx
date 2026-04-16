import { createContext, useContext } from 'react'

const UserContext = createContext(null)

export function UserProvider({ teamMember, children }) {
  return (
    <UserContext.Provider value={teamMember}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  return useContext(UserContext)
}
