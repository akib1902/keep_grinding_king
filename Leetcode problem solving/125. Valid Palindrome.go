//first takes a len(s) then in loop checks isAlnum for both sides and each time checks if they are equal.
//preprocessing: isAlnum and toLower functions. not built in
func isPalindrome(s string) bool {
	i, j := 0, len(s)-1
for i < j {
    if !isAlnum(s[i]) {
        i++
    } else if !isAlnum(s[j]) {
        j--
    } else {
        if toLower(s[i]) != toLower(s[j]) {
            return false
        }
        i++
        j--
    }
}
	return true
}
func isAlnum(c byte) bool {
	return (c >= 'a' && c <= 'z') || 
		(c >= 'A' && c <= 'Z') || 
		(c >= '0' && c <= '9')
}
func toLower(c byte) byte {
	if c >= 'A' && c <= 'Z' {
		return c + 32
	}
	return c
}