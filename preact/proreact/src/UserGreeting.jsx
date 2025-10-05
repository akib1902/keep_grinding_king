import PropTypes from "prop-types"
function UserGreeting({ username = "Guest", isLoggedIn = false }) {
    
    const welcome_message = <h2 className="welcome_message"> welcome {username}</h2>
    const loginPrompt = <h2 className="login_message"> please login</h2>

    return(
        
        isLoggedIn ? welcome_message : loginPrompt
        
    )
}
UserGreeting.propTypes = {
    username: PropTypes.string,
    isLoggedIn: PropTypes.bool,
}
export default UserGreeting