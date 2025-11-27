# if duplicate front if not replace with prev 
class Solution:
    def removeDuplicates(self, nums: List[int]) -> int:
        k=1
        if len(nums)<=1:
            return k
        for i in range(1,len(nums)):
            if nums[i]!=nums[i-k]:
                nums[k]=nums[i]
                k+=1
        return k
