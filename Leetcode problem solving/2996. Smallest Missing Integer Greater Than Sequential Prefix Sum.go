//a go program that checks an array to find the longest sequential prefix of nums and sums it. outputs the next big integer > sum which is not available in array.
func missingInteger(nums []int) int {
    if len(nums) == 0 {
		return 0
	}
	sum := nums[0]
	for i := 1; i < len(nums); i++ {
		if nums[i] == nums[i-1]+1 {
			sum += nums[i]
		} else {
			break
		}
	}
	numSet := make(map[int]bool)
	for _, num := range nums {
		numSet[num] = true
	}
	for numSet[sum] {
		sum++
	}

	return sum
}
